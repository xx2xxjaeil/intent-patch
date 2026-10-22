import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { GitPrivateAgentIntentStore } from "../../src/infrastructure/git/git-private-agent-intent-store.js";

const executeFile = promisify(execFile);
const repositories: string[] = [];
afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("GitPrivateAgentIntentStore", () => {
  it("captures HEAD and prompt in a private Git file, then consumes it once", async () => {
    const repo = await createRepository();
    const store = new GitPrivateAgentIntentStore();
    await store.capture("session A", repo, "회원 탈퇴 기능 구현");
    const directory = join(repo, ".git", "intentpatch-hooks");
    const [name] = await readdir(directory);
    assert.ok(name);
    assert.ok(name.endsWith(".json"));
    if (process.platform !== "win32") {
      assert.equal((await stat(directory)).mode & 0o077, 0);
      assert.equal((await stat(join(directory, name))).mode & 0o077, 0);
    }
    assert.equal((await readFile(join(directory, name), "utf8")).includes("회원 탈퇴"), true);
    const head = (await executeFile("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    assert.deepEqual(await store.take("session A", repo), {
      baseRef: head,
      intent: "회원 탈퇴 기능 구현",
    });
    assert.equal(await store.take("session A", repo), undefined);
    assert.deepEqual(await readdir(directory), []);
  });

  it("isolates session state and removes failed sessions", async () => {
    const repo = await createRepository();
    const store = new GitPrivateAgentIntentStore();
    await store.capture("A", repo, "one");
    await store.capture("B", repo, "two");
    await store.clear("A", repo);
    assert.equal(await store.take("A", repo), undefined);
    assert.equal((await store.take("B", repo))?.intent, "two");
  });
});

async function createRepository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "intentpatch-claude-store-"));
  repositories.push(repo);
  await executeFile("git", ["init", "--quiet"], { cwd: repo });
  await writeFile(join(repo, "src.ts"), "export const x = 1;\n");
  await executeFile("git", ["add", "src.ts"], { cwd: repo });
  await executeFile(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "Fixture",
    ],
    { cwd: repo },
  );
  return repo;
}
