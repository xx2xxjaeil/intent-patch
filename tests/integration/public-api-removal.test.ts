import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { PublicApiCompatibilityRule } from "../../src/application/rules/public-api-compatibility-rule.js";
import { PublicApiRemovalRule } from "../../src/application/rules/public-api-removal-rule.js";
import { CompareSourceSymbols } from "../../src/application/services/compare-source-symbols.js";
import { RuleEngine } from "../../src/application/services/rule-engine.js";
import { AnalyzeChanges } from "../../src/application/use-cases/analyze-changes.js";
import { GitChangeSource } from "../../src/infrastructure/git/git-change-source.js";
import { GitFileSnapshotSource } from "../../src/infrastructure/git/git-file-snapshot-source.js";
import { TypeScriptSymbolExtractor } from "../../src/infrastructure/typescript/typescript-symbol-extractor.js";

const executeFile = promisify(execFile);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("public API removal integration", () => {
  it("reports an export removed from a tracked TypeScript declaration", async () => {
    const repository = await createRepository();
    await writeFile(join(repository, "api.ts"), "function deleteUser(): void {}\n");

    const snapshots = new GitFileSnapshotSource(repository);
    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([new PublicApiRemovalRule()]),
      new CompareSourceSymbols(snapshots, [new TypeScriptSymbolExtractor()]),
    ).execute();

    assert.deepEqual(report.symbolChanges.changes, [
      {
        path: "api.ts",
        name: "deleteUser",
        symbolKind: "function",
        changeKind: "modified",
        beforeLine: 1,
        afterLine: 1,
        beforeExported: true,
        afterExported: false,
        beforePublicApi: { kind: "function", signatures: ["():void"] },
      },
    ]);
    assert.deepEqual(report.findings.items, [
      {
        ruleId: "api/export-removed",
        severity: "high",
        title: "Public export removed",
        description: "The function deleteUser is no longer exported.",
        file: "api.ts",
        evidence: {
          symbolName: "deleteUser",
          symbolKind: "function",
          previousLine: 1,
          currentLine: 1,
        },
      },
    ]);
  });

  it("reports a changed public function signature from Git snapshots", async () => {
    const repository = await createRepository(
      "export function findUser(id: string): string { return id; }\n",
    );
    await writeFile(
      join(repository, "api.ts"),
      "export function findUser(id: number): string { return String(id); }\n",
    );

    const snapshots = new GitFileSnapshotSource(repository);
    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([new PublicApiCompatibilityRule()]),
      new CompareSourceSymbols(snapshots, [new TypeScriptSymbolExtractor()]),
    ).execute();

    assert.deepEqual(report.findings.items, [
      {
        ruleId: "api/public-signature-changed",
        severity: "high",
        title: "Public function contract changed",
        description:
          "The exported function findUser no longer provides every previous call signature.",
        file: "api.ts",
        evidence: {
          symbolName: "findUser",
          removedSignatures: "(string):string",
          previousSignatures: "(string):string",
          currentSignatures: "(number):string",
          currentLine: 1,
        },
      },
    ]);
  });

  it("reports a removed public re-export", async () => {
    const repository = await createRepository('export { findUser } from "./user.js";\n');
    await writeFile(join(repository, "api.ts"), "");

    const snapshots = new GitFileSnapshotSource(repository);
    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([new PublicApiRemovalRule()]),
      new CompareSourceSymbols(snapshots, [new TypeScriptSymbolExtractor()]),
    ).execute();

    assert.equal(report.findings.items.length, 1);
    assert.deepEqual(report.findings.items[0]?.evidence, {
      symbolName: "findUser",
      symbolKind: "re-export",
      previousLine: 1,
    });
  });
});

async function createRepository(
  initialSource = "export function deleteUser(): void {}\n",
): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-public-api-test-"));
  temporaryRepositories.push(repository);

  await runGit(repository, ["init", "--quiet"]);
  await writeFile(join(repository, "api.ts"), initialSource);
  await runGit(repository, ["add", "api.ts"]);
  await runGit(repository, [
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
  ]);

  return repository;
}

async function runGit(repository: string, arguments_: readonly string[]): Promise<void> {
  await executeFile("git", [...arguments_], { cwd: repository });
}
