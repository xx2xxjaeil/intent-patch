import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertMatchingIntegrity } from "../../scripts/check-published-version.mjs";

describe("published package integrity", () => {
  it("accepts an already published version only when its tarball matches", () => {
    assert.doesNotThrow(() =>
      assertMatchingIntegrity("intentpatch@0.1.1", "sha512-expected", "sha512-expected"),
    );
    assert.throws(
      () => assertMatchingIntegrity("intentpatch@0.1.1", "sha512-local", "sha512-published"),
      /different tarball/,
    );
  });
});
