import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { YarnYamlLockParser } from "../../src/infrastructure/yarn/yarn-lock-parser.js";

const parser = new YarnYamlLockParser();

describe("YarnYamlLockParser", () => {
  it("reads only Yarn 4 registry resolutions and marks root dependencies", () => {
    const result = parser.parse(
      `__metadata:\n  version: 8\n"@scope/core@npm:^1.0.0":\n  version: 1.2.0\n  resolution: "@scope/core@npm:1.2.0"\n"app@workspace:.":\n  version: 0.0.0-use.local\n  resolution: "app@workspace:."\n  dependencies:\n    "@scope/core": "npm:^1.0.0"\n"local@workspace:packages/local":\n  version: 0.0.0-use.local\n  resolution: "local@workspace:packages/local"\n`,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      [...result.packages.values()],
      [{ id: "@scope/core@npm:1.2.0", name: "@scope/core", version: "1.2.0", rootDirect: true }],
    );
  });

  it("rejects Classic lockfiles, malformed YAML, and inconsistent versions", () => {
    assert.deepEqual(parser.parse("__metadata:\n  version: 6\n"), {
      ok: false,
      kind: "unsupported",
      reason: "Only Yarn 4 lockfile metadata version 8 is supported; found 6.",
    });
    assert.equal(parser.parse('# yarn lockfile v1\nfoo@^1:\n  version "1.0.0"').ok, false);
    assert.equal(
      parser.parse("__metadata:\n  version: 8\nfoo:\n  version: 1.0.0\n  resolution: foo@npm:2.0.0")
        .ok,
      false,
    );
  });
});
