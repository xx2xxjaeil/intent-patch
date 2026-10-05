import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { GitChangeSource } from "../../src/infrastructure/git/git-change-source.js";

const executeFile = promisify(execFile);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("GitChangeSource integration", () => {
  it("collects tracked and untracked working-tree changes", async () => {
    const repository = await createRepository();
    await writeFile(join(repository, "tracked.txt"), "first\nsecond\n");
    await writeFile(join(repository, "untracked.txt"), "new\nfile\n");

    const result = await new GitChangeSource(repository).collect({ baseRef: "HEAD" });

    assert.deepEqual(
      {
        filesChanged: result.summary.filesChanged,
        additions: result.summary.additions,
        deletions: result.summary.deletions,
        binaryFiles: result.summary.binaryFiles,
        unmeasuredFiles: result.summary.unmeasuredFiles,
      },
      {
        filesChanged: 2,
        additions: 3,
        deletions: 0,
        binaryFiles: 0,
        unmeasuredFiles: 0,
      },
    );
    assert.deepEqual(result.files, [
      {
        path: "tracked.txt",
        kind: "modified",
        lines: { kind: "measured", additions: 1, deletions: 0 },
      },
      {
        path: "untracked.txt",
        kind: "added",
        lines: { kind: "measured", additions: 2, deletions: 0 },
      },
    ]);
  });

  it("collects a rename using Git's NUL-delimited output", async () => {
    const repository = await createRepository();
    await runGit(repository, ["mv", "tracked.txt", "renamed file.txt"]);

    const result = await new GitChangeSource(repository).collect({ baseRef: "HEAD" });

    assert.deepEqual(result.files, [
      {
        path: "renamed file.txt",
        previousPath: "tracked.txt",
        kind: "renamed",
        lines: { kind: "measured", additions: 0, deletions: 0 },
      },
    ]);
  });
});

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-test-"));
  temporaryRepositories.push(repository);

  await runGit(repository, ["init", "--quiet"]);
  await writeFile(join(repository, "tracked.txt"), "first\n");
  await runGit(repository, ["add", "tracked.txt"]);
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
    "Initial fixture",
  ]);

  return repository;
}

async function runGit(repository: string, arguments_: readonly string[]): Promise<void> {
  await executeFile("git", [...arguments_], { cwd: repository });
}
