import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createChangeSet } from "../../src/domain/change.js";
import { GitPatchPreviewSource } from "../../src/infrastructure/git/git-patch-preview-source.js";
import type { CommandRequest } from "../../src/infrastructure/process/command-runner.js";

describe("GitPatchPreviewSource", () => {
  it("uses literal paths and keeps only hunk lines for a renamed file", async () => {
    let request: CommandRequest | undefined;
    const source = new GitPatchPreviewSource("/repo", {
      run: async (value) => {
        request = value;
        return "diff --git a/old.ts b/new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-old\n+new\n";
      },
    });
    const changes = createChangeSet([
      {
        path: "new[1].ts",
        previousPath: "old[1].ts",
        kind: "renamed",
        lines: { kind: "measured", additions: 1, deletions: 1 },
      },
    ]);

    const previews = await source.collect({ baseRef: "main", headRef: "feature" }, changes.files);

    assert.deepEqual(request?.arguments.slice(-3), [
      "--",
      ":(literal)old[1].ts",
      ":(literal)new[1].ts",
    ]);
    assert.ok(request?.arguments.includes("main...feature"));
    assert.deepEqual(previews[0]?.lines, ["@@ -1 +1 @@", "-old", "+new"]);
  });

  it("marks binary and untracked files without failing the analysis", async () => {
    const source = new GitPatchPreviewSource("/repo", { run: async () => "" });
    const changes = createChangeSet([
      { path: "a.png", kind: "modified", lines: { kind: "binary" } },
      {
        path: "new.ts",
        kind: "added",
        lines: { kind: "measured", additions: 2, deletions: 0 },
      },
    ]);
    const previews = await source.collect({ baseRef: "HEAD" }, changes.files);
    assert.equal(previews[0]?.unavailableReason, "Binary file");
    assert.match(previews[1]?.unavailableReason ?? "", /No text patch/);
  });
});
