import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModuleReferenceExtractor } from "../../src/application/ports/module-reference-extractor.js";
import type {
  ProjectFileReadResult,
  ProjectFileSource,
} from "../../src/application/ports/project-file-source.js";
import { AnalyzeImportImpact } from "../../src/application/services/analyze-import-impact.js";
import { createChangeSet } from "../../src/domain/change.js";

describe("AnalyzeImportImpact", () => {
  it("finds direct and transitive dependents through relative TypeScript imports", async () => {
    const analyzer = new AnalyzeImportImpact(
      projectFiles({
        "src/core.ts": "",
        "src/api.ts": "./core.js",
        "src/app.ts": "./api",
        "src/unrelated.ts": "external-package",
      }),
      [fixtureExtractor()],
    );

    const result = await analyzer.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changedFile("src/core.ts")]),
    });

    assert.deepEqual(
      result.impactedFiles.map(({ path, distance }) => ({ path, distance })),
      [
        { path: "src/api.ts", distance: 1 },
        { path: "src/app.ts", distance: 2 },
      ],
    );
    assert.equal(result.summary.dependencies, 2);
    assert.equal(result.summary.directDependents, 1);
    assert.equal(result.summary.transitiveDependents, 1);
  });

  it("resolves index files and preserves unresolved relative imports", async () => {
    const analyzer = new AnalyzeImportImpact(
      projectFiles({
        "src/feature/index.ts": "",
        "src/app.ts": "./feature|./missing.js",
      }),
      [fixtureExtractor()],
    );

    const result = await analyzer.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changedFile("src/feature/index.ts")]),
    });

    assert.deepEqual(result.dependencies, [
      { importer: "src/app.ts", imported: "src/feature/index.ts" },
    ]);
    assert.deepEqual(result.unresolvedReferences, [
      { importer: "src/app.ts", specifier: "./missing.js" },
    ]);
  });

  it("keeps unreadable and unparsable files as analysis issues", async () => {
    const files = projectFiles({
      "src/broken.ts": "parse-error",
      "src/large.ts": { kind: "unavailable", reason: "File is too large" },
    });
    const analyzer = new AnalyzeImportImpact(files, [fixtureExtractor()]);

    const result = await analyzer.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
    });

    assert.deepEqual(result.issues, [
      { path: "src/broken.ts", reason: "Syntax error" },
      { path: "src/large.ts", reason: "File is too large" },
    ]);
  });
});

function changedFile(path: string) {
  return {
    path,
    kind: "modified" as const,
    lines: { kind: "measured" as const, additions: 1, deletions: 1 },
  };
}

function projectFiles(
  contents: Readonly<Record<string, string | ProjectFileReadResult>>,
): ProjectFileSource {
  return {
    listPaths: async () => Object.keys(contents),
    read: async (_target, path) => {
      const value = contents[path];
      if (value === undefined) {
        return { kind: "missing" };
      }
      return typeof value === "string" ? { kind: "success", content: value } : value;
    },
  };
}

function fixtureExtractor(): ModuleReferenceExtractor {
  return {
    supports: (path) => path.endsWith(".ts"),
    extract: (_path, source) =>
      source === "parse-error"
        ? { kind: "unavailable", reason: "Syntax error" }
        : { kind: "success", specifiers: source.length === 0 ? [] : source.split("|") },
  };
}
