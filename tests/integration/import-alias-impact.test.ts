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
import { TypeScriptModuleAliasResolver } from "../../src/infrastructure/typescript/typescript-module-alias-resolver.js";
import { TypeScriptModuleReferenceExtractor } from "../../src/infrastructure/typescript/typescript-module-reference-extractor.js";

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
      [new TypeScriptModuleReferenceExtractor()],
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
});

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
