import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TypeScriptSymbolExtractor } from "../../src/infrastructure/typescript/typescript-symbol-extractor.js";

describe("TypeScriptSymbolExtractor", () => {
  it("extracts overload contracts for exported methods and excludes private methods", () => {
    const result = new TypeScriptSymbolExtractor().extract(
      "src/service.ts",
      [
        "export class Service {",
        "  run(value: string): string;",
        "  run(value: string | number): string { return String(value); }",
        "  private hidden(value: string): string { return value; }",
        "}",
      ].join("\n"),
    );
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const publicMethod = result.symbols.find((symbol) => symbol.name === "Service.run");
    const privateMethod = result.symbols.find((symbol) => symbol.name === "Service.hidden");
    assert.deepEqual(publicMethod?.publicApi, {
      kind: "function",
      signatures: ["(string):string"],
    });
    assert.equal(privateMethod?.publicApi, undefined);
  });

  const extractor = new TypeScriptSymbolExtractor();

  it("supports TypeScript files but not JavaScript files", () => {
    assert.equal(extractor.supports("src/user.ts"), true);
    assert.equal(extractor.supports("src/view.tsx"), true);
    assert.equal(extractor.supports("src/user.js"), false);
  });

  it("tracks enum declarations and public class methods without exporting private methods", () => {
    const result = extractor.extract(
      "src/service.ts",
      [
        "export enum State { Ready, Done }",
        "export class Service {",
        "  run(value: string): string;",
        "  run(value: string) { return value; }",
        "  static create() { return new Service(); }",
        "  private secret() { return 1; }",
        "}",
      ].join("\n"),
    );
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(
      result.symbols.map(({ name, kind, exported }) => ({ name, kind, exported })),
      [
        { name: "State", kind: "enum", exported: true },
        { name: "Service", kind: "class", exported: true },
        { name: "Service.run", kind: "method", exported: true },
        { name: "Service.static.create", kind: "method", exported: true },
        { name: "Service.secret", kind: "method", exported: false },
      ],
    );
  });

  it("extracts named top-level declarations and ignores variables and nested symbols", () => {
    const result = extractor.extract(
      "src/user.ts",
      [
        "export function createUser() {",
        "  function nested() {}",
        "}",
        "export class UserService {}",
        "export interface User extends Entity { id: string; delete(force?: boolean): Promise<void> }",
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
    assert.deepEqual(result.symbols.find((symbol) => symbol.name === "createUser")?.publicApi, {
      kind: "function",
      signatures: ["():inferred"],
    });
    assert.deepEqual(result.symbols.find((symbol) => symbol.name === "User")?.publicApi, {
      kind: "interface",
      extendsTypes: ["Entity"],
      members: [
        {
          name: "delete",
          memberKind: "method",
          optional: false,
          signature: "(boolean?):Promise<void>",
        },
        {
          name: "id",
          memberKind: "property",
          optional: false,
          signature: "string",
        },
      ],
    });
    assert.equal(result.symbols.find((symbol) => symbol.name === "UserId")?.publicApi, undefined);
    assert.equal(
      result.symbols.find((symbol) => symbol.name === "internalOnly")?.publicApi,
      undefined,
    );
  });

  it("resolves exported object types through local aliases and intersections", () => {
    const result = extractor.extract(
      "src/options.ts",
      [
        "type TimeoutOptions = { timeout?: number; throwOnTimeout?: boolean };",
        "export type Options = { concurrency?: number } & TimeoutOptions;",
      ].join("\n"),
    );

    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(
      result.symbols.find((symbol) => symbol.name === "TimeoutOptions")?.publicApi,
      undefined,
    );
    assert.deepEqual(result.symbols.find((symbol) => symbol.name === "Options")?.publicApi, {
      kind: "type-alias",
      members: [
        { name: "concurrency", memberKind: "property", optional: true, signature: "number" },
        { name: "throwOnTimeout", memberKind: "property", optional: true, signature: "boolean" },
        { name: "timeout", memberKind: "property", optional: true, signature: "number" },
      ],
    });
  });

  it("does not infer members from unions or unresolved and recursive aliases", () => {
    const result = extractor.extract(
      "src/options.ts",
      [
        "export type Union = { old?: boolean } | { next?: boolean };",
        "export type External = { old?: boolean } & ImportedOptions;",
        "type Recursive = { old?: boolean } & Recursive;",
        "export type Cyclic = Recursive;",
        "export type Indexed = { old?: boolean; [key: string]: unknown };",
      ].join("\n"),
    );

    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    for (const name of ["Union", "External", "Cyclic", "Indexed"]) {
      assert.equal(result.symbols.find((symbol) => symbol.name === name)?.publicApi, undefined);
    }
  });

  it("normalizes quoted static member names", () => {
    const result = extractor.extract(
      "src/options.ts",
      'export type Options = { "throwOnTimeout"?: boolean };',
    );

    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(result.symbols[0]?.publicApi, {
      kind: "type-alias",
      members: [
        { name: "throwOnTimeout", memberKind: "property", optional: true, signature: "boolean" },
      ],
    });
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
      assert.deepEqual(result.symbols[0]?.publicApi, {
        kind: "function",
        signatures: ["(number):number", "(string):string"],
      });
    }
  });

  it("recognizes local export lists and external re-exports", () => {
    const result = extractor.extract(
      "src/index.ts",
      [
        "function local(value: string): string { return value; }",
        "export { local };",
        'export { remote as publicRemote } from "./remote.js";',
        'export * from "./shared.js";',
      ].join("\n"),
    );

    assert.equal(result.kind, "success");
    if (result.kind === "success") {
      assert.deepEqual(
        result.symbols.map(({ name, kind, exported }) => ({ name, kind, exported })),
        [
          { name: "local", kind: "function", exported: true },
          { name: "publicRemote", kind: "re-export", exported: true },
          { name: '* from "./shared.js"', kind: "re-export", exported: true },
        ],
      );
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
