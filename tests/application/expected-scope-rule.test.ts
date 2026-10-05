import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExpectedScopeRule } from "../../src/application/rules/expected-scope-rule.js";
import { matchesPathPattern } from "../../src/application/services/path-pattern.js";
import { createChangeSet, type FileChange } from "../../src/domain/change.js";
import { createChangeContract } from "../../src/domain/change-contract.js";

describe("matchesPathPattern", () => {
  it("matches repository paths with *, **, and ? wildcards", () => {
    assert.equal(matchesPathPattern("src/user/service.ts", "src/user/**"), true);
    assert.equal(matchesPathPattern("src/user.ts", "src/*.ts"), true);
    assert.equal(matchesPathPattern("src/nested/user.ts", "src/*.ts"), false);
    assert.equal(matchesPathPattern("account.test.ts", "**/*.test.ts"), true);
    assert.equal(matchesPathPattern("tests/user/account.test.ts", "**/*.test.ts"), true);
    assert.equal(matchesPathPattern("src/user.ts", "src/?ser.ts"), true);
    assert.equal(matchesPathPattern("src/userland/service.ts", "src/user/**"), false);
  });
});

describe("ExpectedScopeRule", () => {
  it("does nothing when no expected paths were configured", async () => {
    const findings = await new ExpectedScopeRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changedFile("src/payment.ts")]),
      contract: createChangeContract({ intent: "회원 탈퇴 구현" }),
    });

    assert.deepEqual(findings, []);
  });

  it("reports each change outside expected and explicitly allowed paths", async () => {
    const findings = await new ExpectedScopeRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([
        changedFile("src/user/delete-user.ts"),
        changedFile("tests/user/delete-user.test.ts"),
        changedFile("package.json"),
        changedFile("src/payment/billing.ts"),
      ]),
      contract: createChangeContract({
        intent: "회원 탈퇴 구현",
        scope: {
          include: ["src/user/**", "tests/user/**"],
          allow: ["package.json"],
        },
      }),
    });

    assert.deepEqual(findings, [
      {
        ruleId: "scope/outside-expected-path",
        severity: "medium",
        title: "Change outside expected scope",
        description: "src/payment/billing.ts does not match any expected or allowed path pattern.",
        file: "src/payment/billing.ts",
        evidence: {
          path: "src/payment/billing.ts",
          expectedPatterns: "src/user/**, tests/user/**",
          allowedPatterns: "package.json",
          intent: "회원 탈퇴 구현",
        },
      },
    ]);
  });
});

function changedFile(path: string): FileChange {
  return {
    path,
    kind: "modified",
    lines: { kind: "measured", additions: 1, deletions: 1 },
  };
}
