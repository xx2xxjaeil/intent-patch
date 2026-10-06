import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  CodeStructureExtractionResult,
  CodeStructureExtractor,
} from "../../src/application/ports/code-structure-extractor.js";
import type { ProjectFileSource } from "../../src/application/ports/project-file-source.js";
import { AnalyzeCodeStructure } from "../../src/application/services/analyze-code-structure.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";

describe("AnalyzeCodeStructure", () => {
  it("finds existing duplicate functions and interfaces with one implementation", async () => {
    const files = createFileSource([
      "src/new.ts",
      "src/also-new.ts",
      "src/existing.ts",
      "src/strategy.ts",
      "src/implementations.ts",
      "README.md",
    ]);
    const extractor = new FixtureExtractor({
      "src/new.ts": success({
        functions: [functionFact("newAuth", "shared", 20, 3)],
        interfaces: [interfaceFact("Strategy", 8), interfaceFact("MultiStrategy", 12)],
      }),
      "src/also-new.ts": success({
        functions: [functionFact("anotherNewAuth", "shared", 20, 2)],
      }),
      "src/existing.ts": success({
        functions: [functionFact("authorize", "shared", 20, 4), functionFact("tiny", "tiny", 4, 9)],
      }),
      "src/strategy.ts": success({
        classes: [classFact("DefaultStrategy", ["Strategy"], 5)],
      }),
      "src/implementations.ts": success({
        classes: [
          classFact("FirstStrategy", ["MultiStrategy"], 1),
          classFact("SecondStrategy", ["MultiStrategy"], 4),
        ],
      }),
    });
    const analysis = await new AnalyzeCodeStructure(files, [extractor]).analyze(
      contextWithAddedSymbols(),
    );

    assert.deepEqual(analysis.duplicateCandidates, [
      {
        added: { path: "src/also-new.ts", name: "anotherNewAuth", line: 2 },
        existing: { path: "src/existing.ts", name: "authorize", line: 4 },
      },
      {
        added: { path: "src/new.ts", name: "newAuth", line: 3 },
        existing: { path: "src/existing.ts", name: "authorize", line: 4 },
      },
    ]);
    assert.deepEqual(analysis.singleImplementationAbstractions, [
      {
        abstraction: { path: "src/new.ts", name: "Strategy", line: 8 },
        implementation: { path: "src/strategy.ts", name: "DefaultStrategy", line: 5 },
      },
    ]);
    assert.deepEqual(analysis.summary, {
      sourceFiles: 5,
      filesUnavailable: 0,
      duplicateCandidates: 2,
      singleImplementationAbstractions: 1,
    });
  });

  it("ignores short implementations and preserves read and parse failures", async () => {
    const files: ProjectFileSource = {
      listPaths: async () => ["src/new.ts", "src/unreadable.ts", "src/broken.ts"],
      read: async (_target, path) =>
        path === "src/unreadable.ts"
          ? { kind: "unavailable", reason: "permission denied" }
          : { kind: "success", content: path },
    };
    const extractor = new FixtureExtractor({
      "src/new.ts": success({ functions: [functionFact("newAuth", "tiny", 4, 1)] }),
      "src/broken.ts": { kind: "unavailable", reason: "syntax error" },
    });
    const analysis = await new AnalyzeCodeStructure(files, [extractor]).analyze(
      contextWithAddedSymbols(),
    );

    assert.deepEqual(analysis.duplicateCandidates, []);
    assert.deepEqual(analysis.issues, [
      { path: "src/broken.ts", reason: "syntax error" },
      { path: "src/unreadable.ts", reason: "permission denied" },
    ]);
  });

  it("does not scan the project when no supported symbols were added", async () => {
    let listed = false;
    const analysis = await new AnalyzeCodeStructure(
      {
        listPaths: async () => {
          listed = true;
          return [];
        },
        read: async () => ({ kind: "missing" }),
      },
      [],
    ).analyze({ target: { baseRef: "HEAD" }, changes: createChangeSet([]) });

    assert.equal(listed, false);
    assert.equal(analysis.summary.sourceFiles, 0);
  });
});

function contextWithAddedSymbols() {
  return {
    target: { baseRef: "HEAD" },
    changes: createChangeSet([]),
    symbolChanges: createSymbolChangeSet([
      addedSymbol("src/new.ts", "newAuth", "function"),
      addedSymbol("src/also-new.ts", "anotherNewAuth", "function"),
      addedSymbol("src/new.ts", "Strategy", "interface"),
      addedSymbol("src/new.ts", "MultiStrategy", "interface"),
    ]),
  } as const;
}

function addedSymbol(path: string, name: string, symbolKind: "function" | "interface") {
  return { path, name, symbolKind, changeKind: "added" as const };
}

function functionFact(name: string, fingerprint: string, tokenCount: number, line: number) {
  return { name, line, implementationFingerprint: fingerprint, tokenCount };
}

function interfaceFact(name: string, line: number) {
  return { name, line };
}

function classFact(name: string, implementedTypes: readonly string[], line: number) {
  return { name, line, implementedTypes };
}

function success(
  facts: Partial<Extract<CodeStructureExtractionResult, { kind: "success" }>["facts"]>,
): CodeStructureExtractionResult {
  return {
    kind: "success",
    facts: {
      functions: facts.functions ?? [],
      interfaces: facts.interfaces ?? [],
      classes: facts.classes ?? [],
    },
  };
}

function createFileSource(paths: readonly string[]): ProjectFileSource {
  return {
    listPaths: async () => paths,
    read: async (_target, path) => ({ kind: "success", content: path }),
  };
}

class FixtureExtractor implements CodeStructureExtractor {
  public constructor(
    private readonly results: Readonly<Record<string, CodeStructureExtractionResult>>,
  ) {}

  public supports(path: string): boolean {
    return path.endsWith(".ts");
  }

  public extract(path: string): CodeStructureExtractionResult {
    return this.results[path] ?? success({});
  }
}
