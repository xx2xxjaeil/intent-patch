import {
  type CodeStructureAnalysis,
  type CodeStructureAnalysisIssue,
  type CodeSymbolLocation,
  createCodeStructureAnalysis,
  type DuplicateImplementationCandidate,
  type SingleImplementationAbstraction,
} from "../../domain/code-structure.js";
import type { SymbolChange } from "../../domain/symbol-change.js";
import type { AnalysisContext } from "../ports/analysis-rule.js";
import type { CodeStructureAnalyzer } from "../ports/code-structure-analyzer.js";
import type {
  ClassImplementationFact,
  CodeStructureExtractor,
  FunctionImplementationFact,
  InterfaceDeclarationFact,
} from "../ports/code-structure-extractor.js";
import type { ProjectFileSource } from "../ports/project-file-source.js";

const minimumImplementationTokens = 12;

interface LocatedFunction extends FunctionImplementationFact {
  readonly path: string;
}

interface LocatedInterface extends InterfaceDeclarationFact {
  readonly path: string;
}

interface LocatedClass extends ClassImplementationFact {
  readonly path: string;
}

/** 새 심볼과 현재 프로젝트 구조를 비교해 재사용·추상화 검토 대상을 계산한다. */
export class AnalyzeCodeStructure implements CodeStructureAnalyzer {
  public constructor(
    private readonly files: ProjectFileSource,
    private readonly extractors: readonly CodeStructureExtractor[],
  ) {}

  public async analyze(context: AnalysisContext): Promise<CodeStructureAnalysis> {
    const addedFunctions = addedSymbols(context, "function");
    const addedInterfaces = addedSymbols(context, "interface");
    if (addedFunctions.length === 0 && addedInterfaces.length === 0) {
      return emptyAnalysis();
    }

    const allPaths = await this.files.listPaths(context.target);
    const sourcePaths = allPaths.filter((path) => this.extractorFor(path) !== undefined);
    const functions: LocatedFunction[] = [];
    const interfaces: LocatedInterface[] = [];
    const classes: LocatedClass[] = [];
    const issues: CodeStructureAnalysisIssue[] = [];

    // 대규모 저장소에서 파일 핸들과 Git 프로세스가 폭증하지 않도록 순차 처리한다.
    for (const path of sourcePaths) {
      const extractor = this.extractorFor(path);
      if (extractor === undefined) {
        continue;
      }
      const file = await this.files.read(context.target, path);
      if (file.kind === "missing") {
        continue;
      }
      if (file.kind === "unavailable") {
        issues.push({ path, reason: file.reason });
        continue;
      }

      const extraction = extractor.extract(path, file.content);
      if (extraction.kind === "unavailable") {
        issues.push({ path, reason: extraction.reason });
        continue;
      }
      functions.push(...extraction.facts.functions.map((fact) => ({ path, ...fact })));
      interfaces.push(...extraction.facts.interfaces.map((fact) => ({ path, ...fact })));
      classes.push(...extraction.facts.classes.map((fact) => ({ path, ...fact })));
    }

    return createCodeStructureAnalysis({
      sourceFiles: sourcePaths.length,
      duplicateCandidates: findDuplicateCandidates(addedFunctions, functions),
      singleImplementationAbstractions: findSingleImplementationAbstractions(
        addedInterfaces,
        interfaces,
        classes,
      ),
      issues,
    });
  }

  private extractorFor(path: string): CodeStructureExtractor | undefined {
    return this.extractors.find((extractor) => extractor.supports(path));
  }
}

function emptyAnalysis(): CodeStructureAnalysis {
  return createCodeStructureAnalysis({
    sourceFiles: 0,
    duplicateCandidates: [],
    singleImplementationAbstractions: [],
  });
}

function addedSymbols(
  context: AnalysisContext,
  symbolKind: "function" | "interface",
): readonly SymbolChange[] {
  return (context.symbolChanges?.changes ?? []).filter(
    (change) => change.changeKind === "added" && change.symbolKind === symbolKind,
  );
}

function findDuplicateCandidates(
  addedChanges: readonly SymbolChange[],
  functions: readonly LocatedFunction[],
): DuplicateImplementationCandidate[] {
  const addedIdentities = new Set(
    addedChanges.map((change) => symbolIdentity(change.path, change.name)),
  );
  const existingFunctions = functions.filter(
    (fact) => !addedIdentities.has(symbolIdentity(fact.path, fact.name)),
  );
  const candidates: DuplicateImplementationCandidate[] = [];

  for (const change of addedChanges) {
    const added = functions.find((fact) => fact.path === change.path && fact.name === change.name);
    if (added === undefined || added.tokenCount < minimumImplementationTokens) {
      continue;
    }
    const existing = existingFunctions
      .filter(
        (candidate) => candidate.implementationFingerprint === added.implementationFingerprint,
      )
      .sort(compareLocatedSymbols)[0];
    if (existing !== undefined) {
      candidates.push({ added: toLocation(added), existing: toLocation(existing) });
    }
  }
  return candidates;
}

function findSingleImplementationAbstractions(
  addedChanges: readonly SymbolChange[],
  interfaces: readonly LocatedInterface[],
  classes: readonly LocatedClass[],
): SingleImplementationAbstraction[] {
  const candidates: SingleImplementationAbstraction[] = [];

  for (const change of addedChanges) {
    const abstraction = interfaces.find(
      (fact) => fact.path === change.path && fact.name === change.name,
    );
    if (abstraction === undefined) {
      continue;
    }
    const implementations = classes.filter((fact) => fact.implementedTypes.includes(change.name));
    if (implementations.length === 1 && implementations[0] !== undefined) {
      candidates.push({
        abstraction: toLocation(abstraction),
        implementation: toLocation(implementations[0]),
      });
    }
  }
  return candidates;
}

function toLocation(
  fact: Readonly<{ path: string; name: string; line: number }>,
): CodeSymbolLocation {
  return { path: fact.path, name: fact.name, line: fact.line };
}

function symbolIdentity(path: string, name: string): string {
  return `${path}\0${name}`;
}

function compareLocatedSymbols(
  left: Readonly<{ path: string; name: string; line: number }>,
  right: Readonly<{ path: string; name: string; line: number }>,
): number {
  return (
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.name.localeCompare(right.name)
  );
}
