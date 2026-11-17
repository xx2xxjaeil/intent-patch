import assert from "node:assert/strict";
import { it } from "node:test";
import { createChangeSet } from "../../src/domain/change.js";
import { createCodeStructureAnalysis } from "../../src/domain/code-structure.js";
import { createFindingSet } from "../../src/domain/finding.js";
import { createImpactAnalysis } from "../../src/domain/impact.js";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";
import { createTestChangeAnalysis } from "../../src/domain/test-change.js";
import { formatReport } from "../../src/presentation/cli/report-formatter.js";
import { reviewGuideForRule } from "../../src/presentation/review-guide.js";

it("gives rule-specific verification and uncertainty without claiming a defect", () => {
  const unused = reviewGuideForRule("dependency/no-static-reference");
  assert.match(unused.verify, /dynamic loading/u);
  assert.match(unused.caveat, /not proof/u);

  const tests = reviewGuideForRule("tests/missing-related-change");
  assert.match(tests.verify, /run them/u);
  assert.match(tests.caveat, /does not execute tests/u);

  const unknown = reviewGuideForRule("custom/unknown");
  assert.match(unknown.caveat, /not proof/u);
});

it("includes review guidance in machine-readable reports", () => {
  const output = formatReport(
    {
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
      findings: createFindingSet([
        {
          ruleId: "tests/missing-related-change",
          severity: "medium",
          title: "Missing related test change",
          description: "No matching test changed.",
          file: "src/user.ts",
          evidence: {},
        },
      ]),
      symbolChanges: createSymbolChangeSet([]),
      codeStructure: createCodeStructureAnalysis({
        sourceFiles: 0,
        duplicateCandidates: [],
        singleImplementationAbstractions: [],
      }),
      impact: createImpactAnalysis({
        sourceFiles: 0,
        changedModules: [],
        dependencies: [],
        impactedFiles: [],
      }),
      testChanges: createTestChangeAnalysis({ testFiles: [], sourceCoverage: [] }),
    },
    "json",
  );
  const parsed = JSON.parse(output) as {
    findings: { items: Array<{ reviewGuide: { verify: string } }> };
  };
  assert.match(parsed.findings.items[0]?.reviewGuide.verify ?? "", /run them/u);
});
