import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Finding } from "../../src/domain/finding.js";
import { shouldFail } from "../../src/presentation/cli/failure-policy.js";

const mediumFinding: Finding = {
  ruleId: "dependency/new-production",
  severity: "medium",
  title: "New production dependency",
  description: "example was added.",
  file: "package.json",
  evidence: { package: "example" },
};

describe("shouldFail", () => {
  it("only fails when a finding reaches the configured threshold", () => {
    assert.equal(shouldFail([mediumFinding], "high"), false);
    assert.equal(shouldFail([mediumFinding], "medium"), true);
    assert.equal(shouldFail([mediumFinding], "low"), true);
    assert.equal(shouldFail([], "low"), false);
  });
});
