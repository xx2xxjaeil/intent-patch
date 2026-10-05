import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGitDiff } from "../../src/infrastructure/git/diff-parser.js";

describe("parseGitDiff", () => {
  it("combines statuses with measured, binary, and renamed file statistics", () => {
    const names = [
      "M",
      "src/account.ts",
      "A",
      "assets/avatar.png",
      "R100",
      "src/old-name.ts",
      "src/new-name.ts",
      "",
    ].join("\0");
    const stats = [
      "12\t3\tsrc/account.ts",
      "-\t-\tassets/avatar.png",
      "2\t1\t",
      "src/old-name.ts",
      "src/new-name.ts",
      "",
    ].join("\0");

    assert.deepEqual(parseGitDiff(names, stats), [
      {
        path: "src/account.ts",
        kind: "modified",
        lines: { kind: "measured", additions: 12, deletions: 3 },
      },
      {
        path: "assets/avatar.png",
        kind: "added",
        lines: { kind: "binary" },
      },
      {
        path: "src/new-name.ts",
        previousPath: "src/old-name.ts",
        kind: "renamed",
        lines: { kind: "measured", additions: 2, deletions: 1 },
      },
    ]);
  });

  it("keeps a change when numstat data is unavailable", () => {
    assert.deepEqual(parseGitDiff("U\0src/conflict.ts\0", ""), [
      {
        path: "src/conflict.ts",
        kind: "unmerged",
        lines: { kind: "unavailable", reason: "Git did not provide line statistics." },
      },
    ]);
  });
});
