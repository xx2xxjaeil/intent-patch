import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ProjectFileReadResult,
  ProjectFileSource,
} from "../../src/application/ports/project-file-source.js";
import { TypeScriptModuleAliasResolver } from "../../src/infrastructure/typescript/typescript-module-alias-resolver.js";

describe("TypeScriptModuleAliasResolver", () => {
  it("uses exact paths before wildcards and tries fallback targets in order", async () => {
    const contents = {
      "tsconfig.json": `{
        // JSONC is supported by TypeScript configs.
        "compilerOptions": {
          "paths": {
            "@/special": ["src/priority.ts"],
            "@/*": ["src/generated/*", "src/*"],
          },
        },
      }`,
      "src/app.ts": "",
      "src/core.ts": "",
      "src/priority.ts": "",
      "src/special.ts": "",
    };
    const prepared = await prepare(contents);

    assert.equal(prepared.resolve("src/app.ts", "@/special"), "src/priority.ts");
    assert.equal(prepared.resolve("src/app.ts", "@/core.js"), "src/core.ts");
    assert.equal(prepared.resolve("src/app.ts", "external-package"), undefined);
    assert.deepEqual(prepared.issues, []);
  });

  it("resolves baseUrl imports without a paths mapping", async () => {
    const prepared = await prepare({
      "tsconfig.json": '{"compilerOptions":{"baseUrl":"src"}}',
      "src/app.ts": "",
      "src/core/index.ts": "",
    });

    assert.equal(prepared.resolve("src/app.ts", "core"), "src/core/index.ts");
  });

  it("uses jsconfig when no tsconfig exists and resolves TSX targets", async () => {
    const prepared = await prepare({
      "jsconfig.json": '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
      "src/app.ts": "",
      "src/view.tsx": "",
    });

    assert.equal(prepared.resolve("src/app.ts", "@/view"), "src/view.tsx");
  });

  it("reads relative extends from the same target and keeps the defining config as paths base", async () => {
    const target = { baseRef: "main", headRef: "feature" };
    const readTargets: unknown[] = [];
    const contents = {
      "tsconfig.json": '{"extends":"./configs/base.json"}',
      "configs/base.json": '{"compilerOptions":{"paths":{"@/*":["../src/*"]}}}',
      "src/app.ts": "",
      "src/core.ts": "",
    };
    const files = projectFiles(contents, readTargets);
    const prepared = await new TypeScriptModuleAliasResolver(files).prepare(
      target,
      Object.keys(contents),
      new Set(["src/app.ts", "src/core.ts"]),
    );

    assert.equal(prepared.resolve("src/app.ts", "@/core"), "src/core.ts");
    assert.deepEqual(readTargets, [target, target]);
    assert.deepEqual(prepared.issues, []);
  });

  it("selects the nearest config for each importer", async () => {
    const prepared = await prepare({
      "tsconfig.json": '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
      "src/core.ts": "",
      "src/app.ts": "",
      "packages/admin/tsconfig.json": '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
      "packages/admin/src/core.ts": "",
      "packages/admin/src/app.ts": "",
    });

    assert.equal(prepared.resolve("src/app.ts", "@/core"), "src/core.ts");
    assert.equal(
      prepared.resolve("packages/admin/src/app.ts", "@/core"),
      "packages/admin/src/core.ts",
    );
  });

  it("reports invalid or unavailable config instead of silently inventing edges", async () => {
    const prepared = await prepare({
      "tsconfig.json": { kind: "unavailable", reason: "Cannot read config" },
      "src/app.ts": "",
      "src/core.ts": "",
    });

    assert.equal(prepared.resolve("src/app.ts", "@/core"), undefined);
    assert.deepEqual(prepared.issues, [{ path: "tsconfig.json", reason: "Cannot read config" }]);
  });

  it("reports malformed JSONC and does not resolve aliases from it", async () => {
    const prepared = await prepare({
      "tsconfig.json": '{"compilerOptions":{"paths":',
      "src/app.ts": "",
      "src/core.ts": "",
    });

    assert.equal(prepared.resolve("src/app.ts", "@/core"), undefined);
    assert.equal(prepared.issues.length, 1);
    assert.equal(prepared.issues[0]?.path, "tsconfig.json");
  });
});

async function prepare(contents: Readonly<Record<string, string | ProjectFileReadResult>>) {
  return new TypeScriptModuleAliasResolver(projectFiles(contents)).prepare(
    { baseRef: "HEAD" },
    Object.keys(contents),
    new Set(Object.keys(contents).filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))),
  );
}

function projectFiles(
  contents: Readonly<Record<string, string | ProjectFileReadResult>>,
  readTargets: unknown[] = [],
): ProjectFileSource {
  return {
    listPaths: async () => Object.keys(contents),
    read: async (target, path) => {
      readTargets.push(target);
      const value = contents[path];
      if (value === undefined) {
        return { kind: "missing" };
      }
      return typeof value === "string" ? { kind: "success", content: value } : value;
    },
  };
}
