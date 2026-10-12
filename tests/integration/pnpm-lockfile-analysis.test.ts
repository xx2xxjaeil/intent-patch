import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { analyzeRepository } from "../../src/presentation/analyze-repository.js";

const executeFile = promisify(execFile);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("pnpm lockfile analysis integration", () => {
  it("finds a resolved package update when only pnpm-lock.yaml changed", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-pnpm-lockfile-test-"));
    temporaryRepositories.push(repository);
    await executeFile("git", ["init", "--quiet"], { cwd: repository });
    await writeFile(join(repository, "package.json"), '{"private":true}\n');
    await writeFile(join(repository, "pnpm-lock.yaml"), lockfile("1.0.0"));
    await executeFile("git", ["add", "package.json", "pnpm-lock.yaml"], { cwd: repository });
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
    await writeFile(join(repository, "pnpm-lock.yaml"), lockfile("1.1.0"));

    const report = await analyzeRepository({ workingDirectory: repository });
    assert.deepEqual(
      report.findings.items
        .filter(({ ruleId }) => ruleId.startsWith("dependency/"))
        .map(({ ruleId, evidence }) => ({ ruleId, evidence })),
      [
        {
          ruleId: "dependency/locked-version-changed",
          evidence: {
            package: "transitive",
            version: "1.1.0",
            packageId: "transitive@1.1.0",
            rootDirect: false,
            from: "1.0.0",
            to: "1.1.0",
          },
        },
      ],
    );
  });
});

function lockfile(version: string): string {
  return `lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages:\n  transitive@${version}: {}\nsnapshots:\n  transitive@${version}: {}\n`;
}
