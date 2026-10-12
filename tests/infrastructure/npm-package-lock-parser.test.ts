import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NpmPackageLockParser } from "../../src/infrastructure/npm/npm-package-lock-parser.js";

const parser = new NpmPackageLockParser();

describe("NpmPackageLockParser", () => {
  for (const lockfileVersion of [2, 3]) {
    it(`reads npm lockfile v${lockfileVersion} by installation path`, () => {
      const result = parser.parse(
        JSON.stringify({
          lockfileVersion,
          packages: {
            "": {
              dependencies: { "@scope/direct": "^1.0.0" },
              devDependencies: { tooling: "^2.0.0" },
            },
            "node_modules/@scope/direct": { version: "1.2.0" },
            "node_modules/tooling": { version: "2.1.0" },
            "node_modules/tooling/node_modules/@scope/direct": { version: "1.0.0" },
            "node_modules/transitive": { version: "3.0.0" },
            "node_modules/local-workspace": { link: true, resolved: "packages/local-workspace" },
            "packages/local-workspace": { version: "1.0.0" },
          },
          // v2 carries a legacy tree; the packages map is the authoritative one.
          dependencies: { transitive: { version: "999.0.0" } },
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.packages.size, 4);
      assert.deepEqual(result.packages.get("node_modules/@scope/direct"), {
        path: "node_modules/@scope/direct",
        name: "@scope/direct",
        version: "1.2.0",
        rootDirect: true,
      });
      assert.equal(result.packages.get("node_modules/tooling")?.rootDirect, true);
      assert.equal(result.packages.get("node_modules/transitive")?.rootDirect, false);
      assert.equal(
        result.packages.get("node_modules/tooling/node_modules/@scope/direct")?.rootDirect,
        false,
      );
    });
  }

  it("rejects malformed package descriptors without silently dropping them", () => {
    const result = parser.parse(
      JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/broken": {} } }),
    );
    assert.deepEqual(result, {
      ok: false,
      kind: "invalid",
      reason: 'packages["node_modules/broken"].version must be a non-empty string.',
    });
  });

  it("identifies unsupported v1 lockfiles", () => {
    const result = parser.parse(JSON.stringify({ lockfileVersion: 1, dependencies: {} }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "unsupported");
  });

  it("treats a missing version field as an invalid lockfile", () => {
    const result = parser.parse(JSON.stringify({ packages: {} }));
    assert.deepEqual(result, {
      ok: false,
      kind: "invalid",
      reason: "lockfileVersion must be an integer.",
    });
  });
});
