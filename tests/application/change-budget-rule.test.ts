import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChangeBudgetRule } from "../../src/application/rules/change-budget-rule.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createChangeContract } from "../../src/domain/change-contract.js";

describe("ChangeBudgetRule", () => {
  it("does nothing when budgets are absent or not exceeded", async () => {
    const changes = createChangeSet([
      {
        path: "src/user.ts",
        kind: "modified",
        lines: { kind: "measured", additions: 3, deletions: 2 },
      },
    ]);
    const rule = new ChangeBudgetRule();

    assert.deepEqual(await rule.analyze({ target: { baseRef: "HEAD" }, changes }), []);
    assert.deepEqual(
      await rule.analyze({
        target: { baseRef: "HEAD" },
        changes,
        contract: createChangeContract({ scope: { maxFiles: 1, maxLines: 5 } }),
      }),
      [],
    );
  });

  it("reports file and measured line budget overruns with numeric evidence", async () => {
    const changes = createChangeSet([
      {
        path: "assets/logo.png",
        kind: "modified",
        lines: { kind: "binary" },
      },
      {
        path: "src/user.ts",
        kind: "modified",
        lines: { kind: "measured", additions: 7, deletions: 4 },
      },
      {
        path: "src/user.test.ts",
        kind: "added",
        lines: { kind: "measured", additions: 5, deletions: 0 },
      },
    ]);

    const findings = await new ChangeBudgetRule().analyze({
      target: { baseRef: "HEAD" },
      changes,
      contract: createChangeContract({ scope: { maxFiles: 2, maxLines: 10 } }),
    });

    assert.deepEqual(findings, [
      {
        ruleId: "scope/file-budget-exceeded",
        severity: "low",
        title: "Changed file budget exceeded",
        description: "3 files changed; the configured maximum is 2.",
        file: ".",
        evidence: { actual: 3, maximum: 2 },
      },
      {
        ruleId: "scope/line-budget-exceeded",
        severity: "low",
        title: "Changed line budget exceeded",
        description: "16 measured lines changed; the configured maximum is 10.",
        file: ".",
        evidence: {
          actual: 16,
          maximum: 10,
          additions: 12,
          deletions: 4,
        },
      },
    ]);
  });
});
