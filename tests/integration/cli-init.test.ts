import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { JsonChangeContractLoader } from "../../src/infrastructure/config/json-change-contract-loader.js";

const executeFile = promisify(execFile);
const cli = fileURLToPath(new URL("../../src/presentation/cli/main.ts", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("CLI init integration", () => {
  it("creates a loadable contract from supplied scope and test paths", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-init-"));
    directories.push(repository);
    const { stdout } = await executeFile(
      "node",
      [
        "--import",
        "tsx",
        cli,
        "init",
        "--cwd",
        repository,
        "--intent",
        "Delete account",
        "--include",
        "src/user/**",
        "--test-source",
        "src/**/*.ts",
        "--test-file",
        "tests/**/*.test.ts",
      ],
      { cwd: projectRoot },
    );
    assert.match(stdout, /change contract created/u);
    const content = await readFile(join(repository, ".intentpatch.json"), "utf8");
    assert.equal(content.endsWith("\n"), true);
    const contract = await new JsonChangeContractLoader().load(repository);
    assert.equal(contract?.intent, "Delete account");
    assert.deepEqual(contract?.scope.include, ["src/user/**"]);
    assert.deepEqual(contract?.tests?.include, ["tests/**/*.test.ts"]);

    await assert.rejects(
      executeFile("node", ["--import", "tsx", cli, "init", "--cwd", repository], {
        cwd: projectRoot,
      }),
      /Change contract already exists/u,
    );
    assert.equal(await readFile(join(repository, ".intentpatch.json"), "utf8"), content);
  });

  it("creates a no-assumption template with scope checks disabled", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-init-empty-"));
    directories.push(repository);
    const { stdout } = await executeFile(
      "node",
      ["--import", "tsx", cli, "init", "--cwd", repository],
      { cwd: projectRoot },
    );
    assert.match(stdout, /Scope checks are off/u);
    const contract = await new JsonChangeContractLoader().load(repository);
    assert.deepEqual(contract?.scope.include, []);
    assert.equal(contract?.tests, undefined);
  });
});
