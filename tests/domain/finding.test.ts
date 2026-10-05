import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFindingSet, type Finding, isSeverityAtLeast } from "../../src/domain/finding.js";

function finding(ruleId: string, severity: Finding["severity"], file: string): Finding {
  return {
    ruleId,
    severity,
    title: ruleId,
    description: `Evidence for ${ruleId}`,
    file,
    evidence: { source: "test" },
  };
}

describe("createFindingSet", () => {
  it("sorts by severity and calculates counts", () => {
    const result = createFindingSet([
      finding("rule/low", "low", "z.ts"),
      finding("rule/high", "high", "b.ts"),
      finding("rule/medium", "medium", "a.ts"),
    ]);

    assert.deepEqual(
      result.items.map((item) => item.ruleId),
      ["rule/high", "rule/medium", "rule/low"],
    );
    assert.deepEqual(result.summary, {
      total: 3,
      bySeverity: { high: 1, medium: 1, low: 1 },
    });
  });
});

describe("isSeverityAtLeast", () => {
  it("compares a finding severity with a quality gate", () => {
    assert.equal(isSeverityAtLeast("medium", "high"), false);
    assert.equal(isSeverityAtLeast("medium", "medium"), true);
    assert.equal(isSeverityAtLeast("medium", "low"), true);
  });
});
