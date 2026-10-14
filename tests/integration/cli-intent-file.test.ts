import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
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

describe("CLI intent file integration", () => {
  it("adds an explicit request to the report without creating scope findings", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-cli-intent-"));
    directories.push(repository);
    await executeFile("git", ["init", "--quiet"], { cwd: repository });
    await writeFile(join(repository, "package.json"), '{"private":true}\n');
    await executeFile("git", ["add", "package.json"], { cwd: repository });
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
        "Base",
      ],
      { cwd: repository },
    );
    await writeFile(join(repository, "request.md"), "Implement account deletion\n");

    const { stdout } = await executeFile(
      "node",
      [
        "--import",
        "tsx",
        cli,
        "analyze",
        "--cwd",
        repository,
        "--intent-file",
        "request.md",
        "--json",
      ],
      { cwd: projectRoot },
    );
    const report = JSON.parse(stdout);
    assert.equal(report.contract.intent, "Implement account deletion");
    assert.equal(report.contract.scope.include.length, 0);
    assert.equal(
      report.findings.items.some(
        (item: { ruleId: string }) => item.ruleId === "scope/outside-expected-path",
      ),
      false,
    );
  });
});
