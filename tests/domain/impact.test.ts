import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImpactAnalysis } from "../../src/domain/impact.js";

describe("createImpactAnalysis", () => {
  it("deduplicates graph evidence and calculates direct and transitive impact", () => {
    const result = createImpactAnalysis({
      sourceFiles: 4,
      changedModules: ["src/core.ts", "src/core.ts"],
      dependencies: [
        { importer: "src/api.ts", imported: "src/core.ts" },
        { importer: "src/api.ts", imported: "src/core.ts" },
        { importer: "src/app.ts", imported: "src/api.ts" },
      ],
      impactedFiles: [
        { path: "src/app.ts", distance: 2, changedModules: ["src/core.ts"] },
        { path: "src/api.ts", distance: 1, changedModules: ["src/core.ts"] },
      ],
      unresolvedReferences: [{ importer: "src/app.ts", specifier: "./missing.js" }],
      issues: [{ path: "src/broken.ts", reason: "Syntax error" }],
    });

    assert.deepEqual(result.summary, {
      sourceFiles: 4,
      changedModules: 1,
      dependencies: 2,
      directDependents: 1,
      transitiveDependents: 1,
      unresolvedReferences: 1,
      filesUnavailable: 1,
    });
    assert.deepEqual(
      result.impactedFiles.map(({ path, distance }) => ({ path, distance })),
      [
        { path: "src/api.ts", distance: 1 },
        { path: "src/app.ts", distance: 2 },
      ],
    );
  });

  it("rejects duplicate impacted paths", () => {
    assert.throws(
      () =>
        createImpactAnalysis({
          sourceFiles: 2,
          changedModules: ["src/core.ts"],
          dependencies: [],
          impactedFiles: [
            { path: "src/api.ts", distance: 1, changedModules: ["src/core.ts"] },
            { path: "src/api.ts", distance: 2, changedModules: ["src/core.ts"] },
          ],
        }),
      /Duplicate impacted file/,
    );
  });
});
