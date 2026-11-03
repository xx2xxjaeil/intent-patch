import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PnpmYamlLockParser } from "../../src/infrastructure/pnpm/pnpm-lock-parser.js";

const parser = new PnpmYamlLockParser();

describe("PnpmYamlLockParser", () => {
  it("reads registry packages and root-direct resolutions from a v9 project document", () => {
    const result = parser.parse(`
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      '@scope/direct':
        specifier: ^1.0.0
        version: 1.2.3(peer@2.0.0)
      local:
        specifier: workspace:*
        version: link:packages/local
  packages/local:
    dependencies:
      transitive:
        specifier: ^2.0.0
        version: 2.1.0
packages:
  '@scope/direct@1.2.3':
    resolution: {integrity: sha512-abc}
  transitive@2.1.0:
    resolution: {integrity: sha512-def}
  local@file:packages/local: {}
snapshots:
  '@scope/direct@1.2.3(peer@2.0.0)': {}
`);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      [...result.packages.values()],
      [
        {
          id: "@scope/direct@1.2.3",
          name: "@scope/direct",
          version: "1.2.3",
          rootDirect: true,
          introducedBy: ["@scope/direct"],
        },
        { id: "transitive@2.1.0", name: "transitive", version: "2.1.0", rootDirect: false },
      ],
    );
  });

  it("traces a transitive snapshot to its direct importer when the snapshot identity is exact", () => {
    const result = parser.parse(`
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      direct:
        version: 1.0.0
packages:
  direct@1.0.0: {}
  leaf@2.0.0: {}
snapshots:
  direct@1.0.0:
    dependencies:
      leaf: 2.0.0
  leaf@2.0.0: {}
`);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.packages.get("leaf@2.0.0")?.introducedBy, ["direct"]);
  });

  it("does not attribute a peer variant to a different plain package snapshot", () => {
    const result = parser.parse(`
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      direct:
        version: 1.0.0
packages:
  direct@1.0.0: {}
  leaf@2.0.0: {}
snapshots:
  direct@1.0.0:
    dependencies:
      leaf: 2.0.0(peer@3.0.0)
  leaf@2.0.0: {}
`);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.packages.get("leaf@2.0.0")?.introducedBy, undefined);
  });

  it("uses the project document, not the leading environment document", () => {
    const result = parser.parse(`
---
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm:
        version: 12.3.4
packages:
  pnpm@12.3.4: {}
---
lockfileVersion: '9.0'
importers:
  .: {}
packages:
  app@1.0.0: {}
`);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual([...result.packages.keys()], ["app@1.0.0"]);
  });

  it("reports unsupported versions and malformed YAML without throwing", () => {
    assert.deepEqual(parser.parse("lockfileVersion: '6.0'\nimporters: {}\n"), {
      ok: false,
      kind: "unsupported",
      reason: "Only pnpm lockfile version 9 is supported; found 6.0.",
    });
    const malformed = parser.parse("lockfileVersion: '9.0'\nimporters: [broken\n");
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.equal(malformed.kind, "invalid");
  });

  it("reports invalid project sections instead of silently ignoring them", () => {
    const result = parser.parse(`
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      direct:
        version: 1.0.0
packages:
  direct@1.0.0: []
`);
    assert.deepEqual(result, {
      ok: false,
      kind: "invalid",
      reason: 'packages["direct@1.0.0"] must be a YAML mapping.',
    });
  });
});
