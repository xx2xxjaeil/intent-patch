import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TypeScriptCodeStructureExtractor } from "../../src/infrastructure/typescript/typescript-code-structure-extractor.js";

describe("TypeScriptCodeStructureExtractor", () => {
  const extractor = new TypeScriptCodeStructureExtractor();

  it("supports TypeScript and JavaScript files", () => {
    assert.equal(extractor.supports("src/service.ts"), true);
    assert.equal(extractor.supports("src/view.tsx"), true);
    assert.equal(extractor.supports("src/service.js"), true);
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

  it("matches renamed local bindings while preserving external calls and property names", () => {
    const left = extractor.extract(
      "src/left.ts",
      "function left(value: string) { const result = value.trim(); return result.toLowerCase(); }",
    );
    const renamed = extractor.extract(
      "src/right.ts",
      "function right(input: string) { const trimmed = input.trim(); return trimmed.toLowerCase(); }",
    );
    const different = extractor.extract(
      "src/other.ts",
      "function other(input: string) { const trimmed = input.trim(); return trimmed.toUpperCase(); }",
    );
    assert.equal(left.kind, "success");
    assert.equal(renamed.kind, "success");
    assert.equal(different.kind, "success");
    if (left.kind !== "success" || renamed.kind !== "success" || different.kind !== "success")
      return;
    assert.equal(
      left.facts.functions[0]?.structuralFingerprint,
      renamed.facts.functions[0]?.structuralFingerprint,
    );
    assert.notEqual(
      left.facts.functions[0]?.implementationFingerprint,
      renamed.facts.functions[0]?.implementationFingerprint,
    );
    assert.notEqual(
      left.facts.functions[0]?.structuralFingerprint,
      different.facts.functions[0]?.structuralFingerprint,
    );
  });

  it("extracts class methods and JavaScript functions as duplicate candidates", () => {
    const result = extractor.extract(
      "src/service.ts",
      "class Service { run(value: string) { const result = value.trim(); return result.toLowerCase(); } }",
    );
    const javascript = extractor.extract(
      "src/helper.js",
      "function normalize(value) { const result = value.trim(); return result.toLowerCase(); }",
    );
    assert.equal(extractor.supports("src/helper.js"), true);
    assert.equal(result.kind, "success");
    assert.equal(javascript.kind, "success");
    if (result.kind !== "success" || javascript.kind !== "success") return;
    assert.equal(result.facts.functions[0]?.name, "Service.run");
    assert.equal(result.facts.functions[0]?.symbolKind, "method");
    assert.equal(
      result.facts.functions[0]?.implementationFingerprint,
      javascript.facts.functions[0]?.implementationFingerprint,
    );
  });
});
