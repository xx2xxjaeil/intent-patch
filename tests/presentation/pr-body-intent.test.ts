import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pullRequestBodyIntent } from "../../src/presentation/github/pr-body-intent.js";

describe("pullRequestBodyIntent", () => {
  it("uses a bounded PR body only for PR events", () => {
    const event = { pull_request: { body: "  Implement account deletion  " } };
    assert.equal(pullRequestBodyIntent("pull_request", event), "Implement account deletion");
    assert.equal(pullRequestBodyIntent("push", event), undefined);
    assert.equal(
      pullRequestBodyIntent("pull_request", { pull_request: { body: null } }),
      undefined,
    );
    assert.equal(
      pullRequestBodyIntent("pull_request", { pull_request: { body: "x".repeat(9_000) } }),
      undefined,
    );
  });
});
