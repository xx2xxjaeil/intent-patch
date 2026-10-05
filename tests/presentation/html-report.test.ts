import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createChangeSet } from "../../src/domain/change.js";
import { createChangeContract } from "../../src/domain/change-contract.js";
import { createFindingSet } from "../../src/domain/finding.js";
import { createImpactAnalysis } from "../../src/domain/impact.js";
import type { ChangeReport } from "../../src/domain/report.js";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";
import { createTestChangeAnalysis } from "../../src/domain/test-change.js";
import { formatHtmlReport } from "../../src/presentation/html/html-report.js";

describe("formatHtmlReport", () => {
  it("renders a self-contained report with analysis evidence", () => {
    const output = formatHtmlReport(createReport());

    assert.match(output, /^<!doctype html>/);
    assert.match(output, /Agent Change Report/);
    assert.match(output, /HEAD → working tree/);
    assert.match(output, /Files changed/);
    assert.match(output, /Potential issues/);
    assert.match(output, /Source change without matching test change/);
    assert.match(output, /src\/user\.ts/);
    assert.match(output, /tests\/user\.test\.ts/);
    assert.match(output, /Changed symbols/);
    assert.match(output, /deleteUser/);
    assert.match(output, /<svg[^>]+aria-label="Dependency impact graph"/);
    assert.match(output, /graph-edge direct/);
    assert.match(output, /graph-edge transitive/);
    assert.doesNotMatch(output, /https?:\/\//);
  });

  it("escapes values originating from analyzed repositories", () => {
    const output = formatHtmlReport(createReport());

    assert.match(output, /Delete &lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
    assert.match(output, /Review &lt;unsafe&gt;/);
    assert.doesNotMatch(output, /<script>alert/);
  });
});

function createReport(): ChangeReport {
  return {
    target: { baseRef: "HEAD" },
    contract: createChangeContract({
      intent: "Delete <script>alert('x')</script>",
      scope: { include: ["src/**"], maxFiles: 4 },
      tests: { requireFor: ["src/**"], include: ["tests/**"] },
    }),
    changes: createChangeSet([
      {
        path: "src/user.ts",
        kind: "modified",
        lines: { kind: "measured", additions: 8, deletions: 2 },
      },
      {
        path: "tests/user.test.ts",
        kind: "added",
        lines: { kind: "measured", additions: 12, deletions: 0 },
      },
    ]),
    findings: createFindingSet([
      {
        ruleId: "tests/missing-related-change",
        severity: "medium",
        title: "Source change without matching test change",
        description: "Review <unsafe>",
        file: "src/user.ts",
        evidence: { matchingStrategy: "basename" },
      },
    ]),
    symbolChanges: createSymbolChangeSet([
      {
        path: "src/user.ts",
        name: "deleteUser",
        symbolKind: "function",
        changeKind: "modified",
        afterLine: 12,
      },
    ]),
    impact: createImpactAnalysis({
      sourceFiles: 2,
      changedModules: ["src/user.ts"],
      dependencies: [{ importer: "src/api.ts", imported: "src/user.ts" }],
      impactedFiles: [
        { path: "src/api.ts", distance: 1, changedModules: ["src/user.ts"] },
        { path: "src/app.ts", distance: 2, changedModules: ["src/user.ts"] },
      ],
    }),
    testChanges: createTestChangeAnalysis({
      testFiles: [{ path: "tests/user.test.ts", changeKind: "added" }],
      sourceCoverage: [
        {
          sourcePath: "src/user.ts",
          sourceChangeKind: "modified",
          matchingTests: ["tests/user.test.ts"],
        },
      ],
    }),
  };
}
