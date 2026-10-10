import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertReleaseTag } from "../../scripts/verify-release.mjs";

describe("release tag verification", () => {
  it("accepts the tag that exactly matches the package version", () => {
    assert.doesNotThrow(() => assertReleaseTag("v0.1.0", "0.1.0"));
  });

  it("rejects a tag for a different package version", () => {
    assert.throws(
      () => assertReleaseTag("v0.2.0", "0.1.0"),
      /Release tag must be v0\.1\.0, but received v0\.2\.0\./,
    );
  });

  it("rejects a version without the v tag prefix", () => {
    assert.throws(
      () => assertReleaseTag("0.1.0", "0.1.0"),
      /Release tag must be v0\.1\.0, but received 0\.1\.0\./,
    );
  });
});
