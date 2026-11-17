import assert from "node:assert/strict";
import { it } from "node:test";
import { createChangeSet } from "../../src/domain/change.js";
import { connectDecisions, createDecisionRecord } from "../../src/domain/decision-record.js";
import { createFindingSet } from "../../src/domain/finding.js";

const decision = () =>
  createDecisionRecord({
    id: "stock-reservation",
    question: "When should stock be reserved?",
    options: [
      {
        id: "before",
        title: "Before payment",
        benefits: ["Avoid overselling"],
        tradeoffs: ["Requires expiry"],
      },
      {
        id: "after",
        title: "After payment",
        benefits: ["Simpler checkout"],
        tradeoffs: ["May oversell"],
      },
    ],
    selectedOptionId: "before",
    rationale: "Inventory is scarce.",
    relatedPaths: ["src/old.ts", "src/stock.ts"],
  });

it("links author-declared paths only to observed changes and active findings", () => {
  const result = connectDecisions(
    [decision()],
    createChangeSet([
      {
        path: "src/new.ts",
        previousPath: "src/old.ts",
        kind: "renamed",
        lines: { kind: "measured", additions: 1, deletions: 1 },
      },
      {
        path: "src/stock.ts",
        kind: "modified",
        lines: { kind: "measured", additions: 1, deletions: 0 },
      },
    ]),
    createFindingSet([
      {
        ruleId: "tests/missing-related-change",
        severity: "medium",
        title: "Missing test",
        description: "No test changed",
        file: "src/stock.ts",
        evidence: {},
      },
      {
        ruleId: "scope/outside-expected-path",
        severity: "medium",
        title: "Outside",
        description: "Outside scope",
        file: "README.md",
        evidence: {},
      },
    ]),
  );
  assert.deepEqual(result[0]?.changedPaths, ["src/new.ts", "src/stock.ts"]);
  assert.deepEqual(
    result[0]?.relatedFindings.map((finding) => finding.file),
    ["src/stock.ts"],
  );
});

it("rejects invented selections and paths outside the repository", () => {
  assert.throws(
    () => createDecisionRecord({ ...decision(), selectedOptionId: "invented" }),
    /must match/u,
  );
  assert.throws(
    () => createDecisionRecord({ ...decision(), relatedPaths: ["../secret"] }),
    /repository-relative/u,
  );
});
