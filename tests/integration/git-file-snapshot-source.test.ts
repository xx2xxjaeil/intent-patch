import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { GitFileSnapshotSource } from "../../src/infrastructure/git/git-file-snapshot-source.js";

const executeFile = promisify(execFile);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("GitFileSnapshotSource integration", () => {
  it("reads the base revision and working-tree versions of a text file", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-snapshot-test-"));
    temporaryRepositories.push(repository);
    await runGit(repository, ["init", "--quiet"]);
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({ dependencies: { existing: "1.0.0" } }),
    );
    await runGit(repository, ["add", "package.json"]);
    await commit(repository, "Initial fixture");

    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({ dependencies: { existing: "1.0.0", added: "2.0.0" } }),
    );

    const result = await new GitFileSnapshotSource(repository).read(
      { baseRef: "HEAD" },
      "package.json",
    );

    assert.deepEqual(JSON.parse(result.before ?? ""), {
      dependencies: { existing: "1.0.0" },
    });
    assert.deepEqual(JSON.parse(result.after ?? ""), {
      dependencies: { existing: "1.0.0", added: "2.0.0" },
    });
  });

  it("reads the previous path when a working-tree file was renamed", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-snapshot-rename-test-"));
    temporaryRepositories.push(repository);
    await runGit(repository, ["init", "--quiet"]);
    await writeFile(join(repository, "before.ts"), "export const before = true;\n");
    await runGit(repository, ["add", "before.ts"]);
    await commit(repository, "Initial fixture");
    await runGit(repository, ["mv", "before.ts", "after.ts"]);
    await writeFile(join(repository, "after.ts"), "export const after = true;\n");

    const result = await new GitFileSnapshotSource(repository).read(
      { baseRef: "HEAD" },
      "after.ts",
      "before.ts",
    );

    assert.equal(result.before, "export const before = true;\n");
    assert.equal(result.after, "export const after = true;\n");
  });
});

async function commit(repository: string, message: string): Promise<void> {
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
    message,
  ]);
}

async function runGit(repository: string, arguments_: readonly string[]): Promise<void> {
  await executeFile("git", [...arguments_], { cwd: repository });
}
