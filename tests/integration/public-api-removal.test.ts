import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { GitProjectFileSource } from "../../src/infrastructure/git/git-project-file-source.js";
import { JavaScriptSymbolExtractor } from "../../src/infrastructure/typescript/javascript-symbol-extractor.js";
import { PackageExportsApiBoundary } from "../../src/infrastructure/typescript/package-exports-api-boundary.js";
import { TypeScriptFunctionSignatureCompatibility } from "../../src/infrastructure/typescript/typescript-function-signature-compatibility.js";
import { TypeScriptSymbolExtractor } from "../../src/infrastructure/typescript/typescript-symbol-extractor.js";

const executeFile = promisify(execFile);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("public API removal integration", () => {
  it("reports only source files reachable from the previous package exports", async () => {
    const repository = await createRepository('export { visible } from "./visible.js";\n');
    await writeFile(join(repository, "package.json"), '{"exports":"./api.ts"}\n');
    await writeFile(join(repository, "visible.ts"), "export function visible(): void {}\n");
    await writeFile(join(repository, "private.ts"), "export function hidden(): void {}\n");
    await runGit(repository, ["add", "package.json", "visible.ts", "private.ts"]);
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
      "Add package exports",
    ]);
    await writeFile(join(repository, "visible.ts"), "function visible(): void {}\n");
    await writeFile(join(repository, "private.ts"), "function hidden(): void {}\n");

    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([new PublicApiRemovalRule()]),
      new CompareSourceSymbols(
        new GitFileSnapshotSource(repository),
        [new TypeScriptSymbolExtractor()],
        new PackageExportsApiBoundary(new GitProjectFileSource(repository)),
      ),
    ).execute();

    assert.deepEqual(
      report.findings.items.map((finding) => finding.file),
      ["visible.ts"],
    );
    assert.equal(
      report.symbolChanges.changes.find((change) => change.path === "private.ts")
        ?.beforePubliclyReachable,
      false,
    );
  });

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
      new RuleEngine([
        new PublicApiCompatibilityRule(new TypeScriptFunctionSignatureCompatibility()),
      ]),
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

  it("does not report a function that still accepts the old calls", async () => {
    const repository = await createRepository(
      "export function customAlphabet(alphabet: string, size: number): () => string { return () => alphabet.slice(0, size); }\n",
    );
    await writeFile(
      join(repository, "api.ts"),
      "export function customAlphabet(alphabet: string, defaultSize?: number): (size?: number) => string { return (size = defaultSize) => alphabet.slice(0, size); }\n",
    );

    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([
        new PublicApiCompatibilityRule(new TypeScriptFunctionSignatureCompatibility()),
      ]),
      new CompareSourceSymbols(new GitFileSnapshotSource(repository), [
        new TypeScriptSymbolExtractor(),
      ]),
    ).execute();

    assert.deepEqual(report.findings.items, []);
  });

  it("reports a public type member removed through a local options alias", async () => {
    const repository = await createRepository(
      [
        "type TimeoutOptions = { timeout?: number; throwOnTimeout?: boolean };",
        "export type Options = { concurrency?: number } & TimeoutOptions;",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(repository, "api.ts"),
      [
        "type TimeoutOptions = { timeout?: number };",
        "export type Options = { concurrency?: number } & TimeoutOptions;",
        "",
      ].join("\n"),
    );

    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([
        new PublicApiCompatibilityRule(new TypeScriptFunctionSignatureCompatibility()),
      ]),
      new CompareSourceSymbols(new GitFileSnapshotSource(repository), [
        new TypeScriptSymbolExtractor(),
      ]),
    ).execute();

    assert.equal(
      report.symbolChanges.changes.find((change) => change.name === "Options")?.changeKind,
      "modified",
    );
    assert.deepEqual(report.findings.items, [
      {
        ruleId: "api/public-type-member-removed",
        severity: "high",
        title: "Public type member removed",
        description: "The exported type Options no longer contains every previous member.",
        file: "api.ts",
        evidence: { symbolName: "Options", removedMembers: "throwOnTimeout", currentLine: 2 },
      },
    ]);
  });

  it("does not report a member moved from a local alias into the exported type", async () => {
    const repository = await createRepository(
      "type TimeoutOptions = { throwOnTimeout?: boolean };\nexport type Options = {} & TimeoutOptions;\n",
    );
    await writeFile(
      join(repository, "api.ts"),
      "type TimeoutOptions = {};\nexport type Options = { throwOnTimeout?: boolean } & TimeoutOptions;\n",
    );

    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([
        new PublicApiCompatibilityRule(new TypeScriptFunctionSignatureCompatibility()),
      ]),
      new CompareSourceSymbols(new GitFileSnapshotSource(repository), [
        new TypeScriptSymbolExtractor(),
      ]),
    ).execute();

    assert.deepEqual(report.findings.items, []);
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

  it("preserves an exported name when a re-export becomes a local class", async () => {
    const repository = await createRepository('export { TimeoutError } from "./timeout.js";\n');
    await writeFile(join(repository, "api.ts"), "export class TimeoutError extends Error {}\n");

    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([new PublicApiRemovalRule()]),
      new CompareSourceSymbols(new GitFileSnapshotSource(repository), [
        new TypeScriptSymbolExtractor(),
      ]),
    ).execute();

    assert.deepEqual(report.findings.items, []);
    assert.deepEqual(
      report.symbolChanges.changes.map((change) => [change.symbolKind, change.changeKind]),
      [
        ["class", "added"],
        ["re-export", "deleted"],
      ],
    );
  });

  it("preserves an exported JavaScript name when a variable becomes a function", async () => {
    const repository = await createRepository("export const nanoid = () => 'id';\n", "api.js");
    await writeFile(join(repository, "api.js"), "export function nanoid() { return 'id'; }\n");

    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([new PublicApiRemovalRule()]),
      new CompareSourceSymbols(new GitFileSnapshotSource(repository), [
        new JavaScriptSymbolExtractor(),
      ]),
    ).execute();

    assert.deepEqual(report.findings.items, []);
  });

  it("reports removed JavaScript ESM exports without inferring function signatures", async () => {
    const repository = await createRepository(
      'export const enabled = true;\nexport function run(value) { return value; }\nexport { legacy } from "./legacy.js";\n',
      "api.js",
    );
    await writeFile(
      join(repository, "api.js"),
      "const enabled = true;\nexport function run(value, options) { return value; }\n",
    );

    const snapshots = new GitFileSnapshotSource(repository);
    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([
        new PublicApiRemovalRule(),
        new PublicApiCompatibilityRule(new TypeScriptFunctionSignatureCompatibility()),
      ]),
      new CompareSourceSymbols(snapshots, [new JavaScriptSymbolExtractor()]),
    ).execute();

    assert.deepEqual(
      report.findings.items.map(({ ruleId, evidence }) => ({
        ruleId,
        symbolName: evidence.symbolName,
      })),
      [
        { ruleId: "api/export-removed", symbolName: "enabled" },
        { ruleId: "api/exported-symbol-removed", symbolName: "legacy" },
      ],
    );
    assert.equal(
      report.symbolChanges.changes.find((change) => change.name === "run")?.afterPublicApi,
      undefined,
    );
  });

  it("reports a removed JavaScript default export even when its function remains", async () => {
    const repository = await createRepository(
      "export default function App() { return null; }\n",
      "api.jsx",
    );
    await writeFile(join(repository, "api.jsx"), "function App() { return null; }\n");

    const snapshots = new GitFileSnapshotSource(repository);
    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([new PublicApiRemovalRule()]),
      new CompareSourceSymbols(snapshots, [new JavaScriptSymbolExtractor()]),
    ).execute();

    assert.deepEqual(
      report.findings.items.map(({ ruleId, evidence }) => ({
        ruleId,
        symbolName: evidence.symbolName,
      })),
      [{ ruleId: "api/exported-symbol-removed", symbolName: "default" }],
    );
  });

  it("does not report generated JavaScript bundle exports as source API", async () => {
    const repository = await createRepository("export const source = true;\n", "api.js");
    await mkdir(join(repository, "action-dist"));
    await writeFile(join(repository, "action-dist/index.cjs"), "export const generated = true;\n");
    await runGit(repository, ["add", "action-dist/index.cjs"]);
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
      "Add generated bundle",
    ]);
    await writeFile(join(repository, "action-dist/index.cjs"), "const generated = true;\n");

    const report = await new AnalyzeChanges(
      new GitChangeSource(repository),
      new RuleEngine([new PublicApiRemovalRule()]),
      new CompareSourceSymbols(new GitFileSnapshotSource(repository), [
        new JavaScriptSymbolExtractor(),
      ]),
    ).execute();

    assert.equal(report.symbolChanges.summary.filesAnalyzed, 0);
    assert.deepEqual(report.findings.items, []);
  });
});

async function createRepository(
  initialSource = "export function deleteUser(): void {}\n",
  filename = "api.ts",
): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-public-api-test-"));
  temporaryRepositories.push(repository);

  await runGit(repository, ["init", "--quiet"]);
  await writeFile(join(repository, filename), initialSource);
  await runGit(repository, ["add", filename]);
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
