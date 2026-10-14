import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("pnpm workspace integration", () => {
  it("reports a changed workspace manifest once when npm and pnpm patterns coexist", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-pnpm-workspace-"));
    repositories.push(repository);
    await executeFile("git", ["init", "--quiet"], { cwd: repository });
    await mkdir(join(repository, "packages/api"), { recursive: true });
    await writeFile(join(repository, "package.json"), '{"workspaces":["packages/*"]}\n');
    await writeFile(join(repository, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    await writeFile(
      join(repository, "packages/api/package.json"),
      '{"dependencies":{"existing":"1"}}\n',
    );
    await writeFile(join(repository, "packages/api/index.ts"), "import 'existing';\n");
    await executeFile("git", ["add", "."], { cwd: repository });
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
    await writeFile(
      join(repository, "packages/api/package.json"),
      '{"dependencies":{"existing":"2","candidate":"1"}}\n',
    );

    const report = await analyzeRepository({ workingDirectory: repository });
    assert.deepEqual(
      report.findings.items
        .filter((item) => item.ruleId === "dependency/version-changed")
        .map(({ file, evidence }) => ({ file, evidence })),
      [
        {
          file: "packages/api/package.json",
          evidence: {
            package: "existing",
            from: "1",
            to: "2",
            section: "dependencies",
            workspace: "packages/api",
            packageManager: "pnpm",
          },
        },
      ],
    );
    assert.deepEqual(
      report.findings.items
        .filter((item) => item.ruleId === "dependency/no-static-reference")
        .map(({ file, evidence }) => ({ file, evidence })),
      [
        {
          file: "packages/api/package.json",
          evidence: {
            package: "candidate",
            section: "dependencies",
            scannedFiles: 1,
            workspace: "packages/api",
            packageManager: "pnpm",
          },
        },
      ],
    );
  });
});
