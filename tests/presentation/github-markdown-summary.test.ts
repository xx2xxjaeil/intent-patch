import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createChangeSet } from "../../src/domain/change.js";
import { createCodeStructureAnalysis } from "../../src/domain/code-structure.js";
import { createFindingSet } from "../../src/domain/finding.js";
import { createImpactAnalysis } from "../../src/domain/impact.js";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";
import { createTestChangeAnalysis } from "../../src/domain/test-change.js";
import { formatGitHubSummary } from "../../src/presentation/github/markdown-summary.js";

describe("formatGitHubSummary", () => {
  it("renders metrics and escapes analyzed repository values", () => {
    const output = formatGitHubSummary({
      target: { baseRef: "main", headRef: "feature" },
      changes: createChangeSet([
        {
          path: "src/user.ts",
          kind: "modified",
          lines: { kind: "measured", additions: 3, deletions: 1 },
        },
      ]),
      findings: createFindingSet([
        {
          ruleId: "scope/outside|expected",
          severity: "medium",
          title: "Unexpected <script>|change",
          description: "Changed outside the expected scope.",
          file: "src/user`name.ts",
          evidence: { pattern: "src/api/**" },
        },
      ]),
      symbolChanges: createSymbolChangeSet([]),
      codeStructure: createCodeStructureAnalysis({
        sourceFiles: 1,
        duplicateCandidates: [],
        singleImplementationAbstractions: [],
      }),
      impact: createImpactAnalysis({
        sourceFiles: 1,
        changedModules: ["src/user.ts"],
        dependencies: [],
        impactedFiles: [],
      }),
      testChanges: createTestChangeAnalysis({
        testFiles: [],
        sourceCoverage: [
          { sourcePath: "src/user.ts", sourceChangeKind: "modified", matchingTests: [] },
        ],
      }),
    });

    assert.match(output, /## IntentPatch Change Report/);
    assert.match(output, /\| Files changed \| 1 \|/);
    assert.match(output, /\| Missing test changes \| 1 \|/);
    assert.match(output, /Unexpected &lt;script&gt;&#124;change/);
    assert.match(output, /src\/user&#96;name\.ts/);
    assert.match(output, /scope\/outside&#124;expected/);
    assert.doesNotMatch(output, /<script>/);
  });
});
