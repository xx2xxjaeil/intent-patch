export interface CodeSymbolLocation {
  readonly path: string;
  readonly name: string;
  readonly line: number;
}

export interface DuplicateImplementationCandidate {
  readonly added: CodeSymbolLocation;
  readonly existing: CodeSymbolLocation;
}

export interface SingleImplementationAbstraction {
  readonly abstraction: CodeSymbolLocation;
  readonly implementation: CodeSymbolLocation;
}

export interface CodeStructureAnalysisIssue {
  readonly path: string;
  readonly reason: string;
}

export interface CodeStructureAnalysisSummary {
  readonly sourceFiles: number;
  readonly filesUnavailable: number;
  readonly duplicateCandidates: number;
  readonly singleImplementationAbstractions: number;
}

export interface CodeStructureAnalysis {
  readonly duplicateCandidates: readonly DuplicateImplementationCandidate[];
  readonly singleImplementationAbstractions: readonly SingleImplementationAbstraction[];
  readonly issues: readonly CodeStructureAnalysisIssue[];
  readonly summary: CodeStructureAnalysisSummary;
}

export interface CodeStructureAnalysisInput {
  readonly sourceFiles: number;
  readonly duplicateCandidates: readonly DuplicateImplementationCandidate[];
  readonly singleImplementationAbstractions: readonly SingleImplementationAbstraction[];
  readonly issues?: readonly CodeStructureAnalysisIssue[];
}

/** 구조 분석 근거를 안정적으로 정렬하고 외부에서 변경할 수 없는 결과로 만든다. */
export function createCodeStructureAnalysis(
  input: CodeStructureAnalysisInput,
): CodeStructureAnalysis {
  if (!Number.isInteger(input.sourceFiles) || input.sourceFiles < 0) {
    throw new Error("Code structure source file count must be a non-negative integer");
  }
  assertUniqueDuplicateCandidates(input.duplicateCandidates);
  assertUniqueAbstractions(input.singleImplementationAbstractions);

  const duplicateCandidates = input.duplicateCandidates
    .map((candidate) =>
      Object.freeze({
        added: freezeLocation(candidate.added),
        existing: freezeLocation(candidate.existing),
      }),
    )
    .sort(compareDuplicateCandidates);
  const singleImplementationAbstractions = input.singleImplementationAbstractions
    .map((candidate) =>
      Object.freeze({
        abstraction: freezeLocation(candidate.abstraction),
        implementation: freezeLocation(candidate.implementation),
      }),
    )
    .sort((left, right) => compareLocations(left.abstraction, right.abstraction));
  const issues = [...(input.issues ?? [])]
    .map((issue) => Object.freeze({ ...issue }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return Object.freeze({
    duplicateCandidates: Object.freeze(duplicateCandidates),
    singleImplementationAbstractions: Object.freeze(singleImplementationAbstractions),
    issues: Object.freeze(issues),
    summary: Object.freeze({
      sourceFiles: input.sourceFiles,
      filesUnavailable: issues.length,
      duplicateCandidates: duplicateCandidates.length,
      singleImplementationAbstractions: singleImplementationAbstractions.length,
    }),
  });
}

function freezeLocation(location: CodeSymbolLocation): CodeSymbolLocation {
  return Object.freeze({ ...location });
}

function compareDuplicateCandidates(
  left: DuplicateImplementationCandidate,
  right: DuplicateImplementationCandidate,
): number {
  return (
    compareLocations(left.added, right.added) || compareLocations(left.existing, right.existing)
  );
}

function compareLocations(left: CodeSymbolLocation, right: CodeSymbolLocation): number {
  return (
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.name.localeCompare(right.name)
  );
}

function assertUniqueDuplicateCandidates(
  candidates: readonly DuplicateImplementationCandidate[],
): void {
  assertUnique(
    candidates.map((candidate) =>
      [
        candidate.added.path,
        candidate.added.name,
        candidate.existing.path,
        candidate.existing.name,
      ].join("\0"),
    ),
    "duplicate implementation candidate",
  );
}

function assertUniqueAbstractions(candidates: readonly SingleImplementationAbstraction[]): void {
  assertUnique(
    candidates.map((candidate) =>
      [candidate.abstraction.path, candidate.abstraction.name].join("\0"),
    ),
    "single-implementation abstraction",
  );
}

function assertUnique(identities: readonly string[], label: string): void {
  const unique = new Set(identities);
  if (unique.size !== identities.length) {
    throw new Error(`Duplicate ${label}`);
  }
}
