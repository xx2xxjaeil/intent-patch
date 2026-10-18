import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SourceModuleReferenceExtractor } from "../../src/infrastructure/typescript/source-module-reference-extractor.js";

const extractor = new SourceModuleReferenceExtractor();

describe("SourceModuleReferenceExtractor", () => {
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
