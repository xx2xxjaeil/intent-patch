import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { analyzeRepository } from "../../src/presentation/analyze-repository.js";

const executeFile = promisify(execFile);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Yarn 4 lockfile analysis integration", () => {
  it("reports a registry version change from a real Git working tree", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-yarn-lockfile-test-"));
    repositories.push(repository);
    await executeFile("git", ["init", "--quiet"], { cwd: repository });
    await writeFile(
      join(repository, "package.json"),
      '{"private":true,"packageManager":"yarn@4.0.0"}\n',
    );
    await writeFile(join(repository, "yarn.lock"), lockfile("1.0.0"));
    await executeFile("git", ["add", "package.json", "yarn.lock"], { cwd: repository });
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
      { cwd: repository },
    );
    await writeFile(join(repository, "yarn.lock"), lockfile("1.1.0"));

    const report = await analyzeRepository({ workingDirectory: repository });
    assert.deepEqual(
      report.findings.items.filter((item) => item.file === "yarn.lock").map((item) => item.ruleId),
      ["dependency/locked-version-changed"],
    );
  });
});

function lockfile(version: string): string {
  return `__metadata:\n  version: 8\n"foo@npm:^1":\n  version: ${version}\n  resolution: "foo@npm:${version}"\n`;
}
