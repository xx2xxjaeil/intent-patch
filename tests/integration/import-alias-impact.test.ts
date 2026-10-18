import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { AnalyzeImportImpact } from "../../src/application/services/analyze-import-impact.js";
import { createChangeSet } from "../../src/domain/change.js";
import { GitProjectFileSource } from "../../src/infrastructure/git/git-project-file-source.js";
import { SourceModuleReferenceExtractor } from "../../src/infrastructure/typescript/source-module-reference-extractor.js";
import { TypeScriptModuleAliasResolver } from "../../src/infrastructure/typescript/typescript-module-alias-resolver.js";

const executeFile = promisify(execFile);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("import alias impact integration", () => {
  it("uses the selected Git revision's tsconfig instead of working-tree config", async () => {
    const repository = await createRepository();
    const files = new GitProjectFileSource(repository);
    const analyzer = new AnalyzeImportImpact(
      files,
      [new SourceModuleReferenceExtractor()],
      new TypeScriptModuleAliasResolver(files),
    );
    const changes = createChangeSet([
      {
        path: "src/core.ts",
        kind: "modified",
        lines: { kind: "measured", additions: 1, deletions: 1 },
      },
    ]);

    await writeFile(
      join(repository, "tsconfig.json"),
      '{"compilerOptions":{"paths":{"@/*":["missing/*"]}}}',
    );

    const committed = await analyzer.analyze({
      target: { baseRef: "HEAD", headRef: "HEAD" },
      changes,
    });
    const working = await analyzer.analyze({ target: { baseRef: "HEAD" }, changes });

    assert.deepEqual(committed.dependencies, [{ importer: "src/api.ts", imported: "src/core.ts" }]);
    assert.deepEqual(
      committed.impactedFiles.map(({ path, distance }) => ({ path, distance })),
      [{ path: "src/api.ts", distance: 1 }],
    );
    assert.deepEqual(working.dependencies, []);
  });

  it("finds direct and transitive JavaScript importers across ESM, JSX, and CommonJS", async () => {
    const repository = await createRepository();
    await rm(join(repository, "tsconfig.json"));
    await writeFile(
      join(repository, "jsconfig.json"),
      '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
    );
    await writeFile(join(repository, "src/core.js"), "export const core = true;\n");
    await writeFile(join(repository, "src/aliased.js"), 'import { core } from "@/core.js";\n');
    await writeFile(
      join(repository, "src/view.jsx"),
      'import { core } from "./core.js";\nexport const view = <main>{core}</main>;\n',
    );
    await writeFile(
      join(repository, "src/page.mjs"),
      'import { view } from "./view.jsx";\nexport { view };\n',
    );
    await writeFile(join(repository, "src/legacy.cjs"), 'require("./core.js");\n');
    await writeFile(join(repository, "src/lazy.js"), 'import("./core.js");\n');
    await writeFile(join(repository, "src/extensionless.js"), 'import "./core";\n');
    await writeFile(join(repository, "src/typed.mts"), "export const typed = true;\n");
    await writeFile(join(repository, "src/typed-user.mjs"), 'import "./typed.mjs";\n');
    await runGit(repository, [
      "add",
      "src/core.js",
      "src/aliased.js",
      "src/view.jsx",
      "src/page.mjs",
      "src/legacy.cjs",
      "src/lazy.js",
      "src/extensionless.js",
      "src/typed.mts",
      "src/typed-user.mjs",
      "jsconfig.json",
      "tsconfig.json",
    ]);
    await runGit(repository, [
      "-c",
      "user.name=IntentPatch Test",
      "-c",
      "user.email=intentpatch@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "Add JavaScript fixture",
    ]);

    const files = new GitProjectFileSource(repository);
    const report = await new AnalyzeImportImpact(
      files,
      [new SourceModuleReferenceExtractor()],
      new TypeScriptModuleAliasResolver(files),
    ).analyze({
      target: { baseRef: "HEAD", headRef: "HEAD" },
      changes: createChangeSet([
        {
          path: "src/core.js",
          kind: "modified",
          lines: { kind: "measured", additions: 1, deletions: 1 },
        },
      ]),
    });

    assert.deepEqual(
      report.impactedFiles.map(({ path, distance }) => ({ path, distance })),
      [
        { path: "src/aliased.js", distance: 1 },
        { path: "src/extensionless.js", distance: 1 },
        { path: "src/lazy.js", distance: 1 },
        { path: "src/legacy.cjs", distance: 1 },
        { path: "src/view.jsx", distance: 1 },
        { path: "src/page.mjs", distance: 2 },
      ],
    );
    assert.equal(report.issues.length, 0);

    const typedImpact = await new AnalyzeImportImpact(
      files,
      [new SourceModuleReferenceExtractor()],
      new TypeScriptModuleAliasResolver(files),
    ).analyze({
      target: { baseRef: "HEAD", headRef: "HEAD" },
      changes: createChangeSet([
        {
          path: "src/typed.mts",
          kind: "modified",
          lines: { kind: "measured", additions: 1, deletions: 1 },
        },
      ]),
    });
    assert.deepEqual(
      typedImpact.impactedFiles.map(({ path }) => path),
      ["src/typed-user.mjs"],
    );
  });
});

async function runGit(repository: string, arguments_: readonly string[]): Promise<void> {
  await executeFile("git", [...arguments_], { cwd: repository });
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-alias-impact-test-"));
  temporaryRepositories.push(repository);
  await executeFile("git", ["init", "--quiet"], { cwd: repository });
  await mkdir(join(repository, "src"));
  await writeFile(
    join(repository, "tsconfig.json"),
    '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
  );
  await writeFile(join(repository, "src/core.ts"), "export const core = true;\n");
  await writeFile(join(repository, "src/api.ts"), 'import { core } from "@/core";\n');
  await executeFile("git", ["add", "tsconfig.json", "src/core.ts", "src/api.ts"], {
    cwd: repository,
  });
  await executeFile(
    "git",
    [
      "-c",
      "user.name=IntentPatch Test",
      "-c",
      "user.email=intentpatch@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "Initial fixture",
    ],
    { cwd: repository },
  );
  return repository;
}
