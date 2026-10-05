import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TypeScriptModuleReferenceExtractor } from "../../src/infrastructure/typescript/typescript-module-reference-extractor.js";

describe("TypeScriptModuleReferenceExtractor", () => {
  const extractor = new TypeScriptModuleReferenceExtractor();

  it("supports TypeScript files but not JavaScript files", () => {
    assert.equal(extractor.supports("src/user.ts"), true);
    assert.equal(extractor.supports("src/view.tsx"), true);
    assert.equal(extractor.supports("src/user.js"), false);
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
      specifiers: ["./bootstrap.js", "./legacy.cjs", "./session.js", "./shared.js", "./user.js"],
    });
  });

  it("returns positional evidence for syntax errors", () => {
    const result = extractor.extract("src/broken.ts", 'import { user from "./user.js";');

    assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable") {
      assert.match(result.reason, /line 1, column/);
    }
  });
});
