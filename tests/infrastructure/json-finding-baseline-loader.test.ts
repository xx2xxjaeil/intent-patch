import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBaseline } from "../../src/infrastructure/config/json-finding-baseline-loader.js";

describe("parseBaseline", () => {
  const valid = {
    version: 1,
    entries: [
      {
        ruleId: "api/public-signature-changed",
        file: "src/api.ts",
        evidence: { symbolName: "removeUser" },
        reason: "Reviewed migration",
        expires: "2026-12-01",
      },
    ],
  };

  it("accepts a specific exception with reason and expiry", () => {
    assert.equal(parseBaseline(valid)[0]?.evidence.symbolName, "removeUser");
  });

  it("rejects broad, invalid, and unknown policy fields", () => {
    assert.throws(
      () => parseBaseline({ ...valid, entries: [{ ...valid.entries[0], evidence: {} }] }),
      /at least one/,
    );
    assert.throws(
      () => parseBaseline({ ...valid, entries: [{ ...valid.entries[0], expires: "tomorrow" }] }),
      /YYYY-MM-DD/,
    );
    assert.throws(
      () => parseBaseline({ ...valid, entries: [{ ...valid.entries[0], expires: "2026-02-30" }] }),
      /YYYY-MM-DD/,
    );
    assert.throws(() => parseBaseline({ ...valid, unexpected: true }), /Unknown field/);
  });
});
