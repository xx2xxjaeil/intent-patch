import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JavaScriptSymbolExtractor } from "../../src/infrastructure/typescript/javascript-symbol-extractor.js";

describe("JavaScriptSymbolExtractor", () => {
  const extractor = new JavaScriptSymbolExtractor();

  it("supports JavaScript modules but not TypeScript or unrelated files", () => {
    for (const path of ["src/index.js", "src/view.jsx", "src/esm.mjs", "src/cjs.cjs"]) {
      assert.equal(extractor.supports(path), true);
    }
    assert.equal(extractor.supports("src/index.ts"), false);
    assert.equal(extractor.supports("README.md"), false);
  });

  it("tracks named declarations, variable exports, aliases, and default exports", () => {
    const result = extractor.extract(
      "src/index.jsx",
      [
        "export function create() { return <main /> }",
        "export const version = 1, mode = 'fast'",
        "class Internal {}",
        "export { Internal as Service }",
        'export { remote as publicRemote } from "./remote.js"',
        "export default function App() { return <main /> }",
      ].join("\n"),
    );

    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(
      result.symbols.map(({ name, kind, exported }) => ({ name, kind, exported })),
      [
        { name: "create", kind: "function", exported: true },
        { name: "mode", kind: "variable", exported: true },
        { name: "version", kind: "variable", exported: true },
        { name: "Internal", kind: "class", exported: false },
        { name: "Service", kind: "re-export", exported: true },
        { name: "publicRemote", kind: "re-export", exported: true },
        { name: "App", kind: "function", exported: false },
        { name: "default", kind: "re-export", exported: true },
      ],
    );
    assert.equal(
      result.symbols.every((symbol) => symbol.publicApi === undefined),
      true,
    );
  });

  it("retains an exact local export on its declaration", () => {
    const result = extractor.extract("src/api.js", "function run() {}\nexport { run };\n");
    assert.equal(result.kind, "success");
    if (result.kind === "success") {
      assert.deepEqual(
        result.symbols.map(({ name, exported }) => ({ name, exported })),
        [{ name: "run", exported: true }],
      );
    }
  });

  it("rejects malformed JavaScript with positional evidence", () => {
    const result = extractor.extract("src/broken.js", "export function run( {");
    assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable") assert.match(result.reason, /line 1, column/);
  });
});
