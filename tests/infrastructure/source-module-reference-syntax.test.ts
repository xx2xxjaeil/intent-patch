import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SourceModuleReferenceExtractor } from "../../src/infrastructure/typescript/source-module-reference-extractor.js";

describe("SourceModuleReferenceExtractor syntax handling", () => {
  const extractor = new SourceModuleReferenceExtractor();

  it("supports TypeScript and JavaScript files", () => {
    assert.equal(extractor.supports("src/user.ts"), true);
    assert.equal(extractor.supports("src/view.tsx"), true);
    assert.equal(extractor.supports("src/user.js"), true);
    assert.equal(extractor.supports("src/view.jsx"), true);
    assert.equal(extractor.supports("src/module.mjs"), true);
    assert.equal(extractor.supports("src/legacy.cjs"), true);
  });

  it("extracts and deduplicates static imports and re-exports", () => {
    const result = extractor.extract(
      "src/app.ts",
      [
        'import { user } from "./user.js";',
        'import type { User } from "./user.js";',
        'import "./bootstrap.js";',
        'export { session } from "./session.js";',
        'export * from "./shared.js";',
        'import legacy = require("./legacy.cjs");',
        'import("./dynamic.js");',
        'require("./runtime.cjs");',
      ].join("\n"),
    );

    assert.deepEqual(result, {
      kind: "success",
      specifiers: [
        "./bootstrap.js",
        "./dynamic.js",
        "./legacy.cjs",
        "./runtime.cjs",
        "./session.js",
        "./shared.js",
        "./user.js",
      ],
      hasDynamicSpecifier: false,
    });
  });

  it("returns positional evidence for syntax errors", () => {
    const result = extractor.extract("src/broken.ts", 'import { user from "./user.js";');

    assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable") {
      assert.match(result.reason, /line 1, column/);
    }
  });

  it("reads declaration-file imports without requiring emitted JavaScript", () => {
    assert.deepEqual(
      extractor.extract("index.d.ts", 'export { type Options } from "./options.js";'),
      { kind: "success", specifiers: ["./options.js"], hasDynamicSpecifier: false },
    );
  });

  it("returns syntax errors in declaration files as unavailable", () => {
    const result = extractor.extract("index.d.ts", "export interface Options {");
    assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable") {
      assert.match(result.reason, /line 1, column/);
    }
  });
});
