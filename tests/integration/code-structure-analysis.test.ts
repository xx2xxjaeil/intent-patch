import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { DuplicateImplementationRule } from "../../src/application/rules/duplicate-implementation-rule.js";
import { SingleImplementationAbstractionRule } from "../../src/application/rules/single-implementation-abstraction-rule.js";
import { AnalyzeCodeStructure } from "../../src/application/services/analyze-code-structure.js";
import { CompareSourceSymbols } from "../../src/application/services/compare-source-symbols.js";
import { RuleEngine } from "../../src/application/services/rule-engine.js";
import { AnalyzeChanges } from "../../src/application/use-cases/analyze-changes.js";
import { GitChangeSource } from "../../src/infrastructure/git/git-change-source.js";
import { GitFileSnapshotSource } from "../../src/infrastructure/git/git-file-snapshot-source.js";
import { GitProjectFileSource } from "../../src/infrastructure/git/git-project-file-source.js";
import { TypeScriptCodeStructureExtractor } from "../../src/infrastructure/typescript/typescript-code-structure-extractor.js";
import { TypeScriptSymbolExtractor } from "../../src/infrastructure/typescript/typescript-symbol-extractor.js";

const executeFile = promisify(execFile);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("code structure analysis integration", () => {
  it("reports copied implementation and a new interface with one implementation", async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, "feature.ts"),
      [
        "export function verifySession(token: string): string {",
        "  const normalized = token.trim();",
        '  if (normalized.length === 0) { throw new Error("missing"); }',
        "  return normalized.toLowerCase();",
        "}",
        "export interface DeletionStrategy { execute(): void; }",
        "export class DefaultDeletionStrategy implements DeletionStrategy {",
        "  execute(): void {}",
        "}",
      ].join("\n"),
    );

    const snapshots = new GitFileSnapshotSource(repository);
    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([
        new DuplicateImplementationRule(),
        new SingleImplementationAbstractionRule(),
      ]),
      new CompareSourceSymbols(snapshots, [new TypeScriptSymbolExtractor()]),
      undefined,
      undefined,
      new AnalyzeCodeStructure(new GitProjectFileSource(repository), [
        new TypeScriptCodeStructureExtractor(),
      ]),
    ).execute();

    assert.equal(report.codeStructure.summary.duplicateCandidates, 1);
    assert.equal(report.codeStructure.summary.singleImplementationAbstractions, 1);
    assert.deepEqual(
      report.findings.items.map(({ ruleId, severity, file }) => ({ ruleId, severity, file })),
      [
        {
          ruleId: "structure/duplicate-implementation",
          severity: "medium",
          file: "feature.ts",
        },
        {
          ruleId: "structure/single-implementation-abstraction",
          severity: "low",
          file: "feature.ts",
        },
      ],
    );
  });
});

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-structure-test-"));
  temporaryRepositories.push(repository);

  await runGit(repository, ["init", "--quiet"]);
  await writeFile(
    join(repository, "auth.ts"),
    [
      "export function authorize(token: string): string {",
      "  const normalized = token.trim();",
      '  if (normalized.length === 0) { throw new Error("missing"); }',
      "  return normalized.toLowerCase();",
      "}",
    ].join("\n"),
  );
  await runGit(repository, ["add", "auth.ts"]);
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
