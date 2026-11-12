import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const cli = fileURLToPath(new URL("../../src/presentation/cli/main.ts", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("explains inactive checks and enables only configured rules", async () => {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-doctor-"));
  directories.push(repository);
  await executeFile("git", ["init", "-q", repository]);
  await writeFile(join(repository, "README.md"), "# Sample\n");
  await executeFile("git", ["add", "README.md"], { cwd: repository });
  await executeFile(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"],
    { cwd: repository },
  );

  const run = (args: readonly string[]) =>
    executeFile("node", ["--import", "tsx", cli, "doctor", "--cwd", repository, ...args], {
      cwd: projectRoot,
    });
  const unconfigured = (await run([])).stdout;
  assert.match(unconfigured, /Change Contract: not found/u);
  assert.match(unconfigured, /OFF {2}Expected scope/u);
  assert.match(unconfigured, /OFF {2}Related test changes/u);
  assert.match(unconfigured, /init --interactive/u);

  await writeFile(
    join(repository, "custom.json"),
    JSON.stringify({
      scope: { include: ["src/**"], maxFiles: 4 },
      tests: { requireFor: ["src/**"], include: ["tests/**"] },
    }),
  );
  const configured = (await run(["--config", "custom.json"])).stdout;
  assert.match(configured, /Change Contract: loaded/u);
  assert.match(configured, /ON {3}Expected scope/u);
  assert.match(configured, /ON {3}Change budgets/u);
  assert.match(configured, /ON {3}Related test changes/u);
  assert.match(configured, /Tests are not executed/u);
  await assert.rejects(run(["--config", "missing.json"]), /Change contract file not found/u);
});

it("explains the missing initial Git commit", async () => {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-doctor-empty-"));
  directories.push(repository);
  await executeFile("git", ["init", "-q", repository]);
  await assert.rejects(
    executeFile("node", ["--import", "tsx", cli, "doctor", "--cwd", repository], {
      cwd: projectRoot,
    }),
    /at least one commit/u,
  );
});
