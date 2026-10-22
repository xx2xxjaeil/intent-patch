import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectFileSource } from "../../src/application/ports/project-file-source.js";
import { PackageExportsApiBoundary } from "../../src/infrastructure/typescript/package-exports-api-boundary.js";

const target = { baseRef: "HEAD" };

describe("PackageExportsApiBoundary", () => {
  it("suppresses a private file but retains entrypoints and re-exported modules", async () => {
    const boundary = new PackageExportsApiBoundary(
      projectFiles({
        "package.json": '{"exports":{".":{"types":"./src/index.ts","default":"./src/index.js"}}}',
        "src/index.ts": 'export { publicFunction } from "./public.js";\n',
        "src/public.ts": "export function publicFunction() {}\n",
        "src/private.ts": "export function internalFunction() {}\n",
      }),
    );

    assert.deepEqual(
      [
        ...(await boundary.internalPaths(target, [
          "src/index.ts",
          "src/public.ts",
          "src/private.ts",
        ])),
      ],
      ["src/private.ts"],
    );
  });

  it("uses the nearest nested package boundary", async () => {
    const boundary = new PackageExportsApiBoundary(
      projectFiles({
        "package.json": '{"exports":"./src/index.ts"}',
        "src/index.ts": "export const root = true;\n",
        "packages/child/package.json": '{"exports":"./src/index.ts"}',
        "packages/child/src/index.ts": "export const child = true;\n",
        "packages/child/src/internal.ts": "export const privateValue = true;\n",
      }),
    );

    assert.deepEqual(
      [
        ...(await boundary.internalPaths(target, [
          "packages/child/src/internal.ts",
          "src/index.ts",
        ])),
      ],
      ["packages/child/src/internal.ts"],
    );
  });

  it("expands source export patterns while leaving null targets closed", async () => {
    const boundary = new PackageExportsApiBoundary(
      projectFiles({
        "package.json": '{"exports":{"./features/*":"./src/features/*.ts","./internal":null}}',
        "src/features/a.ts": "export const a = true;\n",
        "src/features/b.ts": "export const b = true;\n",
        "src/internal.ts": "export const privateValue = true;\n",
      }),
    );

    assert.deepEqual(
      [...(await boundary.internalPaths(target, ["src/features/a.ts", "src/internal.ts"]))],
      ["src/internal.ts"],
    );
  });

  it("follows an imported binding that the entrypoint exports locally", async () => {
    const boundary = new PackageExportsApiBoundary(
      projectFiles({
        "package.json": '{"exports":"./src/index.ts"}',
        "src/index.ts": 'import { run } from "./run.js";\nexport { run };\n',
        "src/run.ts": "export function run() {}\n",
        "src/private.ts": "export function privateRun() {}\n",
      }),
    );

    assert.deepEqual(
      [...(await boundary.internalPaths(target, ["src/run.ts", "src/private.ts"]))],
      ["src/private.ts"],
    );
  });

  it("does not classify CommonJS forwarding as private without resolving it", async () => {
    const boundary = new PackageExportsApiBoundary(
      projectFiles({
        "package.json": '{"exports":"./src/index.js"}',
        "src/index.js": 'module.exports = require("./run.js");\n',
        "src/run.js": "exports.run = () => true;\n",
      }),
    );

    assert.deepEqual([...(await boundary.internalPaths(target, ["src/run.js"]))], []);
  });

  it("keeps the old warning when exports are absent or point only to generated output", async () => {
    const withoutExports = new PackageExportsApiBoundary(
      projectFiles({
        "package.json": '{"main":"./dist/index.js"}',
        "src/private.ts": "export const value = true;\n",
      }),
    );
    const generatedOnly = new PackageExportsApiBoundary(
      projectFiles({
        "package.json": '{"exports":"./dist/index.js"}',
        "dist/index.js": "export const value = true;\n",
        "src/private.ts": "export const value = true;\n",
      }),
    );

    assert.deepEqual([...(await withoutExports.internalPaths(target, ["src/private.ts"]))], []);
    assert.deepEqual([...(await generatedOnly.internalPaths(target, ["src/private.ts"]))], []);
  });

  it("falls back when a source entrypoint cannot be parsed or resolved", async () => {
    const broken = new PackageExportsApiBoundary(
      projectFiles({
        "package.json": '{"exports":"./src/index.ts"}',
        "src/index.ts": 'export * from "./missing.js";\n',
        "src/private.ts": "export const value = true;\n",
      }),
    );

    assert.deepEqual([...(await broken.internalPaths(target, ["src/private.ts"]))], []);
  });
});

function projectFiles(contents: Readonly<Record<string, string>>): ProjectFileSource {
  return {
    listPaths: async () => Object.keys(contents),
    read: async (_target, path) => {
      const content = contents[path];
      return content === undefined ? { kind: "missing" } : { kind: "success", content };
    },
  };
}
