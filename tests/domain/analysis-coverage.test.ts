import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAnalysisCoverage } from "../../src/domain/analysis-coverage.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createImpactAnalysis } from "../../src/domain/impact.js";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";

describe("createAnalysisCoverage", () => {
  it("separates checked, unavailable, and untargeted changed files", () => {
    const changes = createChangeSet([
      {
        path: "src/checked.ts",
        kind: "modified",
        lines: { kind: "measured", additions: 1, deletions: 0 },
      },
      {
        path: "src/broken.ts",
        kind: "modified",
        lines: { kind: "unavailable", reason: "too large" },
      },
      { path: "docs/guide.md", kind: "modified", lines: { kind: "binary" } },
    ]);
    const symbols = createSymbolChangeSet(
      [],
      [{ path: "src/broken.ts", reason: "parse error" }],
      1,
    );
    const impact = createImpactAnalysis({
      sourceFiles: 8,
      changedModules: ["src/checked.ts"],
      dependencies: [],
      impactedFiles: [],
      unresolvedReferences: [{ importer: "src/checked.ts", specifier: "./missing" }],
      issues: [{ path: "src/broken.ts", reason: "parse error" }],
    });

    assert.deepEqual(createAnalysisCoverage(changes, symbols, impact), {
      changedFiles: 3,
      symbolFilesChecked: 1,
      symbolFilesUnavailable: 1,
      symbolFilesNotTargeted: 1,
      importGraphSourceFilesRead: 8,
      unresolvedImports: 1,
      importGraphIssues: 1,
      binaryFiles: 1,
      unmeasuredLineFiles: 1,
    });
  });
});
