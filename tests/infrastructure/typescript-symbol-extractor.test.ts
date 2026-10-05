import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TypeScriptSymbolExtractor } from "../../src/infrastructure/typescript/typescript-symbol-extractor.js";

describe("TypeScriptSymbolExtractor", () => {
  const extractor = new TypeScriptSymbolExtractor();

  it("supports TypeScript files but not JavaScript files", () => {
    assert.equal(extractor.supports("src/user.ts"), true);
    assert.equal(extractor.supports("src/view.tsx"), true);
    assert.equal(extractor.supports("src/user.js"), false);
  });

  it("extracts named top-level declarations and ignores variables and nested symbols", () => {
    const result = extractor.extract(
      "src/user.ts",
      [
        "export function createUser() {",
        "  function nested() {}",
        "}",
        "export class UserService {}",
        "export interface User { id: string }",
        "export type UserId = string;",
        "export const ignored = true;",
        "function internalOnly() {}",
      ].join("\n"),
    );

    assert.equal(result.kind, "success");
    if (result.kind !== "success") {
      return;
    }
    assert.deepEqual(
      result.symbols.map(({ name, kind, line, exported }) => ({ name, kind, line, exported })),
      [
        { name: "createUser", kind: "function", line: 1, exported: true },
        { name: "UserService", kind: "class", line: 4, exported: true },
        { name: "User", kind: "interface", line: 5, exported: true },
        { name: "UserId", kind: "type-alias", line: 6, exported: true },
        { name: "internalOnly", kind: "function", line: 8, exported: false },
      ],
    );
    assert.equal(
      result.symbols.every((symbol) => symbol.fingerprint.length === 64),
      true,
    );
  });

  it("groups overload declarations into one function symbol", () => {
    const result = extractor.extract(
      "src/parse.ts",
      [
        "export function parse(value: string): string;",
        "export function parse(value: number): number;",
        "export function parse(value: string | number) { return value; }",
      ].join("\n"),
    );

    assert.equal(result.kind, "success");
    if (result.kind === "success") {
      assert.equal(result.symbols.length, 1);
      assert.equal(result.symbols[0]?.name, "parse");
    }
  });

  it("returns positional evidence for syntax errors", () => {
    const result = extractor.extract("src/broken.ts", "export interface Broken {");

    assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable") {
      assert.match(result.reason, /line 1, column/);
    }
  });
});
