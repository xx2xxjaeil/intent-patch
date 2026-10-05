import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createChangeSet } from "../../src/domain/change.js";

describe("createChangeSet", () => {
  it("sorts changes and calculates a summary", () => {
    const result = createChangeSet([
      {
        path: "src/z.ts",
        kind: "modified",
        lines: { kind: "measured", additions: 3, deletions: 1 },
      },
      {
        path: "assets/logo.png",
        kind: "added",
        lines: { kind: "binary" },
      },
      {
        path: "large.txt",
        kind: "added",
        lines: { kind: "unavailable", reason: "Too large" },
      },
    ]);

    assert.deepEqual(
      result.files.map((file) => file.path),
      ["assets/logo.png", "large.txt", "src/z.ts"],
    );
    assert.deepEqual(
      {
        filesChanged: result.summary.filesChanged,
        additions: result.summary.additions,
        deletions: result.summary.deletions,
        binaryFiles: result.summary.binaryFiles,
        unmeasuredFiles: result.summary.unmeasuredFiles,
      },
      {
        filesChanged: 3,
        additions: 3,
        deletions: 1,
        binaryFiles: 1,
        unmeasuredFiles: 1,
      },
    );
    assert.equal(result.summary.filesByKind.added, 2);
    assert.equal(result.summary.filesByKind.modified, 1);
  });

  it("rejects duplicate result paths", () => {
    assert.throws(
      () =>
        createChangeSet([
          {
            path: "src/index.ts",
            kind: "added",
            lines: { kind: "measured", additions: 1, deletions: 0 },
          },
          {
            path: "src/index.ts",
            kind: "modified",
            lines: { kind: "measured", additions: 2, deletions: 1 },
          },
        ]),
      /Duplicate file change path/,
    );
  });
});
