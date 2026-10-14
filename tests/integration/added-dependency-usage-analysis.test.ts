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

describe("added dependency usage integration", () => {
  it("suggests review for a new package with no static source reference", async () => {
    const repository = await mkdtemp(join(tmpdir(), "intentpatch-dependency-usage-"));
    repositories.push(repository);
    await executeFile("git", ["init", "--quiet"], { cwd: repository });
    await writeFile(join(repository, "package.json"), '{"dependencies":{"used":"1"}}\n');
    await writeFile(join(repository, "app.js"), "import 'used/subpath';\n");
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
      join(repository, "package.json"),
      '{"dependencies":{"used":"1","candidate":"2"}}\n',
    );

    const report = await analyzeRepository({ workingDirectory: repository });
    const candidates = report.findings.items.filter(
      (item) => item.ruleId === "dependency/no-static-reference",
    );
    assert.deepEqual(
      candidates.map(({ file, evidence }) => ({ file, evidence })),
      [
        {
          file: "package.json",
          evidence: { package: "candidate", section: "dependencies", scannedFiles: 1 },
        },
      ],
    );
  });
});
