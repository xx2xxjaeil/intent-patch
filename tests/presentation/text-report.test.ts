import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createChangeSet } from "../../src/domain/change.js";
import { createChangeContract } from "../../src/domain/change-contract.js";
import { createCodeStructureAnalysis } from "../../src/domain/code-structure.js";
import { createFindingSet } from "../../src/domain/finding.js";
import { createImpactAnalysis } from "../../src/domain/impact.js";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";
import { createTestChangeAnalysis } from "../../src/domain/test-change.js";
import { formatTextReport } from "../../src/presentation/cli/text-report.js";

describe("formatTextReport", () => {
  it("shows dependency counts and evidence-based findings", () => {
    const output = formatTextReport({
      target: { baseRef: "HEAD" },
      contract: createChangeContract({
        intent: "회원 탈퇴 구현",
        scope: {
          include: ["src/user/**", "tests/user/**"],
          allow: ["package.json"],
          maxFiles: 8,
          maxLines: 300,
        },
        tests: {
          requireFor: ["src/**/*.ts"],
          include: ["tests/**/*.test.ts"],
          exclude: ["src/**/*.d.ts"],
        },
      }),
      changes: createChangeSet([
        {
          path: "package.json",
          kind: "modified",
          lines: { kind: "measured", additions: 1, deletions: 0 },
        },
      ]),
      findings: createFindingSet([
        {
          ruleId: "dependency/new-production",
          severity: "medium",
          title: "New production dependency",
          description: "dayjs@1.0.0 was added to dependencies.",
          file: "package.json",
          evidence: { package: "dayjs", version: "1.0.0" },
        },
        {
          ruleId: "api/exported-symbol-removed",
          severity: "high",
          title: "Exported symbol removed",
          description: "The exported function deleteUser was removed.",
          file: "src/user.ts",
          evidence: { symbolName: "deleteUser", symbolKind: "function" },
        },
      ]),
      symbolChanges: createSymbolChangeSet([
        {
          path: "src/user.ts",
          name: "deleteUser",
          symbolKind: "function",
          changeKind: "added",
          afterLine: 12,
        },
      ]),
      codeStructure: createCodeStructureAnalysis({
        sourceFiles: 4,
        duplicateCandidates: [
          {
            added: { path: "src/user.ts", name: "verifySession", line: 14 },
            existing: { path: "src/auth.ts", name: "authorize", line: 5 },
          },
        ],
        singleImplementationAbstractions: [
          {
            abstraction: { path: "src/user.ts", name: "DeletionStrategy", line: 20 },
            implementation: { path: "src/user.ts", name: "DefaultStrategy", line: 24 },
          },
        ],
      }),
      impact: createImpactAnalysis({
        sourceFiles: 4,
        changedModules: ["src/core.ts"],
        dependencies: [
          { importer: "src/api.ts", imported: "src/core.ts" },
          { importer: "src/app.ts", imported: "src/api.ts" },
        ],
        impactedFiles: [
          { path: "src/api.ts", distance: 1, changedModules: ["src/core.ts"] },
          { path: "src/app.ts", distance: 2, changedModules: ["src/core.ts"] },
        ],
        unresolvedReferences: [{ importer: "src/app.ts", specifier: "./missing.js" }],
      }),
      testChanges: createTestChangeAnalysis({
        testFiles: [{ path: "tests/user.test.ts", changeKind: "modified" }],
        sourceCoverage: [
          {
            sourcePath: "src/user.ts",
            sourceChangeKind: "modified",
            matchingTests: ["tests/user.test.ts"],
          },
        ],
      }),
    });

    assert.match(output, /New dependencies {5}1/);
    assert.match(output, /Risky API changes {4}1/);
    assert.match(output, /Duplicate candidates 1/);
    assert.match(output, /Single implementations 1/);
    assert.match(output, /Findings {13}2/);
    assert.match(output, /Changed symbols {6}1/);
    assert.match(output, /Tests changed {8}1/);
    assert.match(output, /Tests added {10}0/);
    assert.match(output, /Missing test changes 0/);
    assert.match(output, /Intent {10}회원 탈퇴 구현/);
    assert.match(output, /Expected paths {2}src\/user\/\*\*, tests\/user\/\*\*/);
    assert.match(output, /Budget {10}8 files, 300 measured lines/);
    assert.match(output, /Test sources {4}src\/\*\*\/\*\.ts/);
    assert.match(output, /Test files {6}tests\/\*\*\/\*\.test\.ts/);
    assert.match(output, /Test excludes {3}src\/\*\*\/\*\.d\.ts/);
    assert.match(output, /Direct dependents {4}1/);
    assert.match(output, /Transitive impact {4}1/);
    assert.match(output, /A {2}Function {6}deleteUser/);
    assert.match(output, /src\/user\.ts:12/);
    assert.match(output, /direct {14}src\/api\.ts/);
    assert.match(output, /transitive · 2 hops {1}src\/app\.ts/);
    assert.match(output, /src\/app\.ts → \.\/missing\.js/);
    assert.match(output, /MEDIUM {2}New production dependency/);
    assert.match(output, /package\.json · dependency\/new-production/);
    assert.match(output, /HIGH {4}Exported symbol removed/);
    assert.match(output, /src\/user\.ts · api\/exported-symbol-removed/);
  });
});
