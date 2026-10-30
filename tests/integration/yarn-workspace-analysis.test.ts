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

describe("Yarn workspace analysis integration", () => {
  it("reports a changed workspace manifest once with Yarn provenance", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-yarn-workspace-"));
    temporaryRepositories.push(repository);
    await executeFile("git", ["init", "--quiet"], { cwd: repository });
    await mkdir(join(repository, "packages/api"), { recursive: true });
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({ private: true, packageManager: "yarn@4.10.0", workspaces: ["packages/*"] }),
    );
    await writeFile(join(repository, "yarn.lock"), "__metadata:\n  version: 8\n");
    await writeFile(
      join(repository, "packages/api/package.json"),
      JSON.stringify({ name: "@example/api", dependencies: { existing: "^1.0.0" } }),
    );
    await executeFile("git", ["add", "package.json", "yarn.lock", "packages/api/package.json"], {
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
        .filter(({ ruleId }) => ruleId === "dependency/new-production")
        .map(({ file, evidence }) => ({ file, evidence })),
      [
        {
          file: "packages/api/package.json",
          evidence: {
            package: "added",
            version: "^2.0.0",
            section: "dependencies",
            workspace: "packages/api",
            packageManager: "yarn",
          },
        },
      ],
    );
  });
});
