import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveGitHubComparison } from "../../src/presentation/github/comparison.js";

describe("resolveGitHubComparison", () => {
  it("prefers an explicit comparison", () => {
    assert.deepEqual(
      resolveGitHubComparison({ baseRef: "main", headRef: "feature" }, "pull_request", undefined),
      { baseRef: "main", headRef: "feature" },
    );
  });

  it("reads pull request commit SHAs", () => {
    assert.deepEqual(
      resolveGitHubComparison({}, "pull_request", {
        pull_request: {
          base: { sha: "base-sha" },
          head: { sha: "head-sha" },
        },
      }),
      { baseRef: "base-sha", headRef: "head-sha" },
    );
  });

  it("reads push before and after SHAs", () => {
    assert.deepEqual(
      resolveGitHubComparison({}, "push", { before: "before-sha", after: "after-sha" }),
      { baseRef: "before-sha", headRef: "after-sha" },
    );
  });

  it("requires an explicit base for a new branch push", () => {
    assert.throws(
      () => resolveGitHubComparison({}, "push", { before: "000000", after: "after-sha" }),
      /new-branch push has no base commit/,
    );
  });

  it("uses the previous commit for manual events", () => {
    assert.deepEqual(resolveGitHubComparison({}, "workflow_dispatch", {}), {
      baseRef: "HEAD^",
      headRef: "HEAD",
    });
  });
});
