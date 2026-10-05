import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MissingTestChangeRule } from "../../src/application/rules/missing-test-change-rule.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createChangeContract } from "../../src/domain/change-contract.js";
import { createTestChangeAnalysis } from "../../src/domain/test-change.js";

describe("MissingTestChangeRule", () => {
  it("does nothing when test change analysis is unavailable", async () => {
    const findings = await new MissingTestChangeRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
    });

    assert.deepEqual(findings, []);
  });

  it("reports only source files without a matching changed test", async () => {
    const findings = await new MissingTestChangeRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
      contract: createChangeContract({
        tests: {
          requireFor: ["src/**"],
          include: ["tests/**/*.test.ts", "**/*.spec.ts"],
        },
      }),
      testChanges: createTestChangeAnalysis({
        testFiles: [{ path: "tests/user.test.ts", changeKind: "modified" }],
        sourceCoverage: [
          {
            sourcePath: "src/account.ts",
            sourceChangeKind: "added",
            matchingTests: [],
          },
          {
            sourcePath: "src/user.ts",
            sourceChangeKind: "modified",
            matchingTests: ["tests/user.test.ts"],
          },
        ],
      }),
    });

    assert.deepEqual(findings, [
      {
        ruleId: "tests/missing-related-change",
        severity: "medium",
        title: "Source change without matching test change",
        description: "src/account.ts changed without a changed test sharing the same basename.",
        file: "src/account.ts",
        evidence: {
          sourceChangeKind: "added",
          matchingStrategy: "basename",
          testPatterns: "**/*.spec.ts, tests/**/*.test.ts",
        },
      },
    ]);
  });
});
