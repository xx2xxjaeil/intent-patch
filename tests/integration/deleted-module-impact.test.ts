import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { AnalyzeImportImpact } from "../../src/application/services/analyze-import-impact.js";
import { createChangeSet } from "../../src/domain/change.js";
import { GitProjectFileSource } from "../../src/infrastructure/git/git-project-file-source.js";
import { SourceModuleReferenceExtractor } from "../../src/infrastructure/typescript/source-module-reference-extractor.js";
import { TypeScriptModuleAliasResolver } from "../../src/infrastructure/typescript/typescript-module-alias-resolver.js";

const executeFile = promisify(execFile);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("deleted module impact", () => {
  it("finds surviving direct and transitive importers in the previous graph", async () => {
    const repository = await createRepository({
      "src/deleted.ts": "export const value = true;\n",
      "src/api.ts": 'import { value } from "./deleted.js";\nexport { value };\n',
      "src/app.ts": 'import { value } from "./api.js";\nconsole.log(value);\n',
      "src/gone.ts": 'import { value } from "./deleted.js";\nconsole.log(value);\n',
    });
    await rm(join(repository, "src/deleted.ts"));
    await rm(join(repository, "src/gone.ts"));

    const result = await analyzer(repository).analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([deleted("src/deleted.ts"), deleted("src/gone.ts")]),
    });

    assert.deepEqual(
      result.impactedFiles.map(({ path, distance, viaPreviousImports }) => ({
        path,
        distance,
        viaPreviousImports,
      })),
      [
        { path: "src/api.ts", distance: 1, viaPreviousImports: true },
        { path: "src/app.ts", distance: 2, viaPreviousImports: true },
      ],
    );
    assert.deepEqual(result.dependencies, [{ importer: "src/app.ts", imported: "src/api.ts" }]);
    assert.deepEqual(result.unresolvedReferences, [
      { importer: "src/api.ts", specifier: "./deleted.js" },
    ]);
  });

  it("resolves old aliases with the previous tsconfig, not the modified one", async () => {
    const repository = await createRepository({
      "tsconfig.json": '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
      "src/deleted.ts": "export const value = true;\n",
      "src/api.ts": 'import { value } from "@/deleted";\nexport { value };\n',
    });
    await rm(join(repository, "src/deleted.ts"));
    await writeFile(
      join(repository, "tsconfig.json"),
      '{"compilerOptions":{"paths":{"@/*":["missing/*"]}}}',
    );

    const result = await analyzer(repository).analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([deleted("src/deleted.ts")]),
    });

    assert.deepEqual(result.impactedFiles, [
      {
        path: "src/api.ts",
        distance: 1,
        changedModules: ["src/deleted.ts"],
        viaPreviousImports: true,
      },
    ]);
  });
});

function analyzer(repository: string): AnalyzeImportImpact {
  const files = new GitProjectFileSource(repository);
  return new AnalyzeImportImpact(
    files,
    [new SourceModuleReferenceExtractor()],
    new TypeScriptModuleAliasResolver(files),
  );
}

function deleted(path: string) {
  return {
    path,
    kind: "deleted" as const,
    lines: { kind: "measured" as const, additions: 0, deletions: 1 },
  };
}

async function createRepository(files: Readonly<Record<string, string>>): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-deleted-impact-test-"));
  repositories.push(repository);
  await executeFile("git", ["init", "--quiet"], { cwd: repository });
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(repository, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  await executeFile("git", ["add", "."], { cwd: repository });
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
