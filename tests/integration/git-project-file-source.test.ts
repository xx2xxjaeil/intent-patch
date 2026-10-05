import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { GitProjectFileSource } from "../../src/infrastructure/git/git-project-file-source.js";

const executeFile = promisify(execFile);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("GitProjectFileSource integration", () => {
  it("lists tracked and untracked working-tree files and reads their contents", async () => {
    const repository = await createRepository();
    await writeFile(join(repository, "untracked.ts"), "export const untracked = true;\n");
    const source = new GitProjectFileSource(repository);

    const paths = await source.listPaths({ baseRef: "HEAD" });
    const untracked = await source.read({ baseRef: "HEAD" }, "untracked.ts");

    assert.deepEqual(paths, ["tracked.ts", "untracked.ts"]);
    assert.deepEqual(untracked, {
      kind: "success",
      content: "export const untracked = true;\n",
    });
  });

  it("reads the selected revision instead of modified working-tree content", async () => {
    const repository = await createRepository();
    await writeFile(join(repository, "tracked.ts"), "export const version = 2;\n");
    const source = new GitProjectFileSource(repository);
    const target = { baseRef: "HEAD", headRef: "HEAD" };

    assert.deepEqual(await source.listPaths(target), ["tracked.ts"]);
    assert.deepEqual(await source.read(target, "tracked.ts"), {
      kind: "success",
      content: "export const version = 1;\n",
    });
  });

  it("returns missing when a tracked working-tree file was deleted", async () => {
    const repository = await createRepository();
    await unlink(join(repository, "tracked.ts"));
    const source = new GitProjectFileSource(repository);

    assert.deepEqual(await source.listPaths({ baseRef: "HEAD" }), ["tracked.ts"]);
    assert.deepEqual(await source.read({ baseRef: "HEAD" }, "tracked.ts"), {
      kind: "missing",
    });
  });
});

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-project-source-test-"));
  temporaryRepositories.push(repository);
  await runGit(repository, ["init", "--quiet"]);
  await writeFile(join(repository, "tracked.ts"), "export const version = 1;\n");
  await runGit(repository, ["add", "tracked.ts"]);
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
