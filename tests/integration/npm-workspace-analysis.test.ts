import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("npm workspace analysis integration", () => {
  it("reports dependency changes from a configured workspace in a real Git repository", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-workspace-test-"));
    temporaryRepositories.push(repository);
    await executeFile("git", ["init", "--quiet"], { cwd: repository });
    await mkdir(join(repository, "packages/api"), { recursive: true });
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    );
    await writeFile(
      join(repository, "packages/api/package.json"),
      JSON.stringify({ name: "@example/api", dependencies: { existing: "^1.0.0" } }),
    );
    await executeFile("git", ["add", "package.json", "packages/api/package.json"], {
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
    await writeFile(
      join(repository, "packages/api/package.json"),
      JSON.stringify({
        name: "@example/api",
        dependencies: { existing: "^1.0.0", added: "^2.0.0" },
      }),
    );

    const report = await analyzeRepository({ workingDirectory: repository });
    assert.deepEqual(
      report.findings.items
        .filter(({ ruleId }) => ruleId.startsWith("dependency/"))
        .map(({ ruleId, file, evidence }) => ({ ruleId, file, evidence })),
      [
        {
          ruleId: "dependency/new-production",
          file: "packages/api/package.json",
          evidence: {
            package: "added",
            version: "^2.0.0",
            section: "dependencies",
            workspace: "packages/api",
          },
        },
      ],
    );
  });
});
