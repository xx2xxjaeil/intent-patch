import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnalyzeTestChanges } from "../../src/application/services/analyze-test-changes.js";
import { createChangeSet, type FileChange } from "../../src/domain/change.js";
import { createChangeContract } from "../../src/domain/change-contract.js";

describe("AnalyzeTestChanges", () => {
  it("returns an empty analysis when no test policy was configured", async () => {
    const result = await new AnalyzeTestChanges().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changedFile("src/user.ts")]),
    });

    assert.deepEqual(result, {
      testFiles: [],
      sourceCoverage: [],
      summary: {
        testsChanged: 0,
        testsAdded: 0,
        testsDeleted: 0,
        sourceFilesChecked: 0,
        sourceFilesWithoutTestChanges: 0,
      },
    });
  });

  it("classifies test files and matches them to source files by basename", async () => {
    const result = await new AnalyzeTestChanges().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([
        changedFile("src/account.ts"),
        changedFile("src/generated.d.ts"),
        changedFile("src/user.ts"),
        changedFile("tests/unrelated.test.ts"),
        changedFile("tests/user.integration.test.ts"),
      ]),
      contract: createChangeContract({
        tests: {
          requireFor: ["src/**/*.ts"],
          include: ["tests/**"],
          exclude: ["src/**/*.d.ts"],
        },
      }),
    });

    assert.deepEqual(result.testFiles, [
      { path: "tests/unrelated.test.ts", changeKind: "modified" },
      { path: "tests/user.integration.test.ts", changeKind: "modified" },
    ]);
    assert.deepEqual(result.sourceCoverage, [
      { sourcePath: "src/account.ts", sourceChangeKind: "modified", matchingTests: [] },
      {
        sourcePath: "src/user.ts",
        sourceChangeKind: "modified",
        matchingTests: ["tests/user.integration.test.ts"],
      },
    ]);
    assert.equal(result.summary.sourceFilesWithoutTestChanges, 1);
  });

  it("does not classify co-located test files as production sources", async () => {
    const result = await new AnalyzeTestChanges().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changedFile("src/user.ts"), changedFile("src/user.spec.ts")]),
      contract: createChangeContract({
        tests: {
          requireFor: ["src/**"],
          include: ["**/*.spec.ts"],
        },
      }),
    });

    assert.deepEqual(result.sourceCoverage, [
      {
        sourcePath: "src/user.ts",
        sourceChangeKind: "modified",
        matchingTests: ["src/user.spec.ts"],
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
