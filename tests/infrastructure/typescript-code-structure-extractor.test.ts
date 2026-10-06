import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TypeScriptCodeStructureExtractor } from "../../src/infrastructure/typescript/typescript-code-structure-extractor.js";

describe("TypeScriptCodeStructureExtractor", () => {
  const extractor = new TypeScriptCodeStructureExtractor();

  it("supports TypeScript files", () => {
    assert.equal(extractor.supports("src/service.ts"), true);
    assert.equal(extractor.supports("src/view.tsx"), true);
    assert.equal(extractor.supports("src/service.js"), false);
  });

  it("extracts normalized function bodies and implementation relationships", () => {
    const result = extractor.extract(
      "src/strategy.ts",
      [
        "interface Strategy {}",
        "export function normalize(value: string) {",
        "  // Formatting and comments do not affect the fingerprint.",
        "  const result = value.trim();",
        "  return result.toLowerCase();",
        "}",
        "function duplicate(value: string) { const result=value.trim(); return result.toLowerCase(); }",
        "function different(value: string) { return value.toUpperCase(); }",
        "class DefaultStrategy implements Strategy {}",
        "class OtherStrategy implements contracts.Other<string> {}",
      ].join("\n"),
    );

    assert.equal(result.kind, "success");
    if (result.kind !== "success") {
      return;
    }
    assert.deepEqual(
      result.facts.functions.map(({ name, line }) => ({ name, line })),
      [
        { name: "normalize", line: 2 },
        { name: "duplicate", line: 7 },
        { name: "different", line: 8 },
      ],
    );
    assert.equal(
      result.facts.functions[0]?.implementationFingerprint,
      result.facts.functions[1]?.implementationFingerprint,
    );
    assert.notEqual(
      result.facts.functions[0]?.implementationFingerprint,
      result.facts.functions[2]?.implementationFingerprint,
    );
    assert.equal((result.facts.functions[0]?.tokenCount ?? 0) >= 12, true);
    assert.deepEqual(result.facts.interfaces, [{ name: "Strategy", line: 1 }]);
    assert.deepEqual(result.facts.classes, [
      { name: "DefaultStrategy", line: 9, implementedTypes: ["Strategy"] },
      { name: "OtherStrategy", line: 10, implementedTypes: ["Other"] },
    ]);
  });

  it("ignores nested functions and overload declarations without bodies", () => {
    const result = extractor.extract(
      "src/parse.ts",
      [
        "function parse(value: string): string;",
        "function parse(value: string) { function nested() { return 1; } return value; }",
      ].join("\n"),
    );

    assert.equal(result.kind, "success");
    if (result.kind === "success") {
      assert.deepEqual(
        result.facts.functions.map((fact) => fact.name),
        ["parse"],
      );
    }
  });

  it("returns positional evidence for syntax errors", () => {
    const result = extractor.extract("src/broken.ts", "interface Broken {");

    assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable") {
      assert.match(result.reason, /line 1, column/);
    }
  });
});
