import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFindingSet } from "../../src/domain/finding.js";
import { applyFindingBaseline, type BaselineEntry } from "../../src/domain/finding-baseline.js";

const finding = {
  ruleId: "api/public-signature-changed",
  severity: "high" as const,
  title: "Public signature changed",
  description: "A previous call is no longer accepted.",
  file: "src/api.ts",
  evidence: { symbolName: "removeUser" },
};
const entry: BaselineEntry = {
  ruleId: finding.ruleId,
  file: finding.file,
  evidence: { symbolName: "removeUser" },
  reason: "Reviewed migration for the next release",
  expires: "2026-12-01",
};

describe("finding baseline", () => {
  it("suppresses only the identified finding through its inclusive expiry date", () => {
    const result = applyFindingBaseline(createFindingSet([finding]), [entry], "2026-12-01");
    assert.equal(result.findings.summary.total, 0);
    assert.equal(result.suppressed[0]?.reason, entry.reason);
    assert.equal(result.expired.length, 0);
  });

  it("returns expired exceptions without hiding findings", () => {
    const result = applyFindingBaseline(createFindingSet([finding]), [entry], "2026-12-02");
    assert.equal(result.findings.summary.total, 1);
    assert.equal(result.suppressed.length, 0);
    assert.equal(result.expired.length, 1);
  });

  it("rejects ambiguous or overlapping exceptions", () => {
    const set = createFindingSet([finding, { ...finding, title: "Another signature changed" }]);
    assert.throws(() => applyFindingBaseline(set, [entry], "2026-11-10"), /ambiguous/);
    assert.throws(
      () => applyFindingBaseline(createFindingSet([finding]), [entry, entry], "2026-11-10"),
      /Multiple baseline entries/,
    );
  });
});
