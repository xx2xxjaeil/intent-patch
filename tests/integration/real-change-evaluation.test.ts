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
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("real change evaluation regressions", () => {
  it("compares the full request, not only its temporary breaking commit", async () => {
    // 1cc489b introduced a required GitHubActionInputs member; 81b40f9 made it optional.
    const repository = await createRepository();
    await writeFile(join(repository, "action-inputs.ts"), actionInputs(""));
    const base = await commit(repository, "Original action inputs");

    await writeFile(
      join(repository, "action-inputs.ts"),
      actionInputs("  readonly intentFromPrBody: boolean;\n"),
    );
    const temporary = await commit(repository, "Add required intent input");

    await writeFile(
      join(repository, "action-inputs.ts"),
      actionInputs("  readonly intentFromPrBody?: boolean;\n"),
    );
    const final = await commit(repository, "Keep existing consumers compatible");

    const temporaryReport = await analyze(repository, base, temporary);
    const finalReport = await analyze(repository, base, final);

    assert.deepEqual(
      temporaryReport.findings.items.map((finding) => finding.ruleId),
      ["api/public-interface-changed"],
    );
    assert.equal(temporaryReport.findings.items[0]?.severity, "high");
    assert.equal(
      finalReport.findings.items.some(
        (finding) => finding.ruleId === "api/public-interface-changed",
      ),
      false,
    );
  });

  it("catches the duplicated record guard from the npm workspace change", async () => {
    // 3aed45e added a second isRecord; 81b40f9 later consolidated the guards.
    const repository = await createRepository();
    const guard = [
      "function isRecord(value: unknown): value is Record<string, unknown> {",
      '  return typeof value === "object" && value !== null && !Array.isArray(value);',
      "}",
      "",
    ].join("\n");
    await writeFile(join(repository, "package-dependency-rule.ts"), guard);
    const base = await commit(repository, "Original record guard");

    await writeFile(join(repository, "npm-workspace-dependency-rule.ts"), guard);
    const head = await commit(repository, "Add npm workspace rule");
    const report = await analyze(repository, base, head);

    const duplicate = report.findings.items.find(
      (finding) => finding.ruleId === "structure/duplicate-implementation",
    );
    assert.equal(duplicate?.severity, "medium");
    assert.equal(duplicate?.evidence.existingFile, "package-dependency-rule.ts");
    assert.equal(duplicate?.file, "npm-workspace-dependency-rule.ts");
  });
});

function actionInputs(extraMember: string): string {
  return [
    "export interface GitHubActionInputs {",
    "  readonly workingDirectory: string;",
    extraMember.trimEnd(),
    "  readonly reportDirectory: string;",
    "}",
    "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-real-change-"));
  repositories.push(repository);
  await executeFile("git", ["init", "--quiet"], { cwd: repository });
  return repository;
}

async function commit(repository: string, message: string): Promise<string> {
  await executeFile("git", ["add", "--all"], { cwd: repository });
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
      message,
    ],
    { cwd: repository },
  );
  const { stdout } = await executeFile("git", ["rev-parse", "HEAD"], { cwd: repository });
  return stdout.trim();
}

async function analyze(repository: string, base: string, head: string): Promise<AnalysisResult> {
  const { stdout } = await executeFile(
    "node",
    [
      "--import",
      "tsx",
      cli,
      "analyze",
      "--cwd",
      repository,
      "--base",
      base,
      "--head",
      head,
      "--json",
    ],
    { cwd: projectRoot },
  );
  return JSON.parse(stdout) as AnalysisResult;
}

interface AnalysisResult {
  readonly findings: {
    readonly items: readonly {
      readonly ruleId: string;
      readonly severity: string;
      readonly file: string;
      readonly evidence: Readonly<Record<string, unknown>>;
    }[];
  };
}
