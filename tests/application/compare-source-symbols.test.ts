import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileSnapshotSource } from "../../src/application/ports/file-snapshot-source.js";
import type { SourceSymbolExtractor } from "../../src/application/ports/source-symbol-extractor.js";
import { CompareSourceSymbols } from "../../src/application/services/compare-source-symbols.js";
import { createChangeSet } from "../../src/domain/change.js";
import type { SourceSymbol } from "../../src/domain/symbol-change.js";

describe("CompareSourceSymbols", () => {
  it("detects added, modified, and deleted symbols while ignoring unsupported files", async () => {
    const analyzer = new CompareSourceSymbols(
      snapshotSource({ before: "before", after: "after" }),
      [fixtureExtractor()],
    );
    const result = await analyzer.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changedFile("README.md"), changedFile("src/user.ts")]),
    });

    assert.deepEqual(result.changes, [
      {
        path: "src/user.ts",
        name: "created",
        symbolKind: "function",
        changeKind: "added",
        afterLine: 8,
        afterExported: true,
      },
      {
        path: "src/user.ts",
        name: "changed",
        symbolKind: "class",
        changeKind: "modified",
        beforeLine: 1,
        afterLine: 2,
        beforeExported: true,
        afterExported: false,
      },
      {
        path: "src/user.ts",
        name: "removed",
        symbolKind: "interface",
        changeKind: "deleted",
        beforeLine: 5,
        beforeExported: true,
      },
    ]);
    assert.equal(result.summary.filesAnalyzed, 1);
  });

  it("uses the previous path for a renamed file", async () => {
    const calls: Array<{ path: string; basePath?: string }> = [];
    const analyzer = new CompareSourceSymbols(
      {
        read: async (_target, path, basePath) => {
          calls.push({ path, ...(basePath === undefined ? {} : { basePath }) });
          return { before: "before", after: "after" };
        },
      },
      [fixtureExtractor()],
    );

    await analyzer.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([
        {
          path: "src/new-name.ts",
          previousPath: "src/old-name.ts",
          kind: "renamed",
          lines: { kind: "measured", additions: 1, deletions: 1 },
        },
      ]),
    });

    assert.deepEqual(calls, [{ path: "src/new-name.ts", basePath: "src/old-name.ts" }]);
  });

  it("preserves parser failures as unavailable file evidence", async () => {
    const analyzer = new CompareSourceSymbols(snapshotSource({ after: "broken" }), [
      {
        supports: () => true,
        extract: () => ({ kind: "unavailable", reason: "Unexpected token" }),
      },
    ]);

    const result = await analyzer.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changedFile("src/broken.ts")]),
    });

    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.issues, [
      { path: "src/broken.ts", reason: "current: Unexpected token" },
    ]);
    assert.equal(result.summary.filesUnavailable, 1);
  });
});

function changedFile(path: string) {
  return {
    path,
    kind: "modified" as const,
    lines: { kind: "measured" as const, additions: 1, deletions: 1 },
  };
}

function snapshotSource(
  snapshot: Awaited<ReturnType<FileSnapshotSource["read"]>>,
): FileSnapshotSource {
  return {
    read: async () => snapshot,
  };
}

function fixtureExtractor(): SourceSymbolExtractor {
  const before: SourceSymbol[] = [
    { name: "changed", kind: "class", fingerprint: "old", line: 1, exported: true },
    { name: "removed", kind: "interface", fingerprint: "same", line: 5, exported: true },
  ];
  const after: SourceSymbol[] = [
    { name: "changed", kind: "class", fingerprint: "new", line: 2, exported: false },
    { name: "created", kind: "function", fingerprint: "new", line: 8, exported: true },
  ];

  return {
    supports: (path) => path.endsWith(".ts"),
    extract: (_path, source) => ({
      kind: "success",
      symbols: source === "before" ? before : after,
    }),
  };
}
