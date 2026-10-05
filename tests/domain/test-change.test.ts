import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTestChangeAnalysis } from "../../src/domain/test-change.js";

describe("createTestChangeAnalysis", () => {
  it("sorts evidence and summarizes changed and unmatched tests", () => {
    const result = createTestChangeAnalysis({
      testFiles: [
        { path: "tests/user.test.ts", changeKind: "modified" },
        { path: "tests/account.test.ts", changeKind: "added" },
        { path: "tests/legacy.test.ts", changeKind: "deleted" },
      ],
      sourceCoverage: [
        {
          sourcePath: "src/user.ts",
          sourceChangeKind: "modified",
          matchingTests: ["tests/user.test.ts", "tests/user.test.ts"],
        },
        {
          sourcePath: "src/account.ts",
          sourceChangeKind: "added",
          matchingTests: [],
        },
      ],
    });

    assert.deepEqual(
      result.testFiles.map((file) => file.path),
      ["tests/account.test.ts", "tests/legacy.test.ts", "tests/user.test.ts"],
    );
    assert.deepEqual(result.sourceCoverage[1]?.matchingTests, ["tests/user.test.ts"]);
    assert.deepEqual(result.summary, {
      testsChanged: 3,
      testsAdded: 1,
      testsDeleted: 1,
      sourceFilesChecked: 2,
      sourceFilesWithoutTestChanges: 1,
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.sourceCoverage[0]?.matchingTests), true);
  });

  it("rejects duplicate test and source paths", () => {
    assert.throws(
      () =>
        createTestChangeAnalysis({
          testFiles: [
            { path: "tests/user.test.ts", changeKind: "added" },
            { path: "tests/user.test.ts", changeKind: "modified" },
          ],
          sourceCoverage: [],
        }),
      /Duplicate test file/,
    );
    assert.throws(
      () =>
        createTestChangeAnalysis({
          testFiles: [],
          sourceCoverage: [
            { sourcePath: "src/user.ts", sourceChangeKind: "added", matchingTests: [] },
            { sourcePath: "src/user.ts", sourceChangeKind: "modified", matchingTests: [] },
          ],
        }),
      /Duplicate source file/,
    );
  });
});
