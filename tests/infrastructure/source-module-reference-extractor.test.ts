import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PackageModuleReferenceExtractor } from "../../src/infrastructure/typescript/package-module-reference-extractor.js";
import { SourceModuleReferenceExtractor } from "../../src/infrastructure/typescript/source-module-reference-extractor.js";
import { TypeScriptModuleReferenceExtractor } from "../../src/infrastructure/typescript/typescript-module-reference-extractor.js";

const extractor = new SourceModuleReferenceExtractor();

describe("SourceModuleReferenceExtractor", () => {
  it("keeps the previously published extractor paths usable", () => {
    for (const legacy of [
      new PackageModuleReferenceExtractor(),
      new TypeScriptModuleReferenceExtractor(),
    ]) {
      assert.equal(legacy instanceof SourceModuleReferenceExtractor, true);
      assert.deepEqual(legacy.extract("src/index.js", 'import "./entry.js";'), {
        kind: "success",
        specifiers: ["./entry.js"],
        hasDynamicSpecifier: false,
      });
    }
  });

  it("collects static JS and TS module loads, including subpaths and type imports", () => {
    const source = `
      import type { A } from '@scope/types/subpath';
      export { value } from 'pkg/subpath';
      const a = require('commonjs');
      const b = require.resolve('resolved');
      const c = import('lazy');
      import './local.js';
    `;
    assert.deepEqual(extractor.extract("src/index.ts", source), {
      kind: "success",
      specifiers: [
        "./local.js",
        "@scope/types/subpath",
        "commonjs",
        "lazy",
        "pkg/subpath",
        "resolved",
      ],
      hasDynamicSpecifier: false,
    });
    assert.deepEqual(extractor.extract("config.mjs", "const tool = require('tool')"), {
      kind: "success",
      specifiers: ["tool"],
      hasDynamicSpecifier: false,
    });
  });

  it("marks computed module loads as unknown and declines unsupported files", () => {
    assert.deepEqual(extractor.extract("src/a.ts", "require(packageName)"), {
      kind: "success",
      specifiers: [],
      hasDynamicSpecifier: true,
    });
    assert.equal(extractor.supports("settings.yaml"), false);
    assert.equal(extractor.extract("src/b.ts", "import { from 'broken'").kind, "unavailable");
  });
});
