import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { policyChangeFindings } from "../../src/presentation/github/policy-change-findings.js";

describe("policyChangeFindings", () => {
  it("flags changed or renamed policy files in a PR", () => {
    const files = [
      {
        path: ".intentpatch.json",
        kind: "modified" as const,
        lines: { kind: "measured" as const, additions: 1, deletions: 1 },
      },
      {
        path: "renamed.json",
        previousPath: ".intentpatch-baseline.json",
        kind: "renamed" as const,
        lines: { kind: "measured" as const, additions: 0, deletions: 0 },
      },
    ];
    assert.deepEqual(
      policyChangeFindings("/repo", files).map((finding) => finding.ruleId),
      ["policy/contract-changed", "policy/baseline-changed"],
    );
  });

  it("does not flag unrelated files and rejects policy paths outside the repository", () => {
    assert.deepEqual(policyChangeFindings("/repo", []), []);
    assert.throws(
      () => policyChangeFindings("/repo", [], "../outside.json"),
      /outside the repository/,
    );
  });
});
