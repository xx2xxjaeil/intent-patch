export interface ModuleDependency {
  readonly importer: string;
  readonly imported: string;
}

export interface ImpactedFile {
  readonly path: string;
  readonly distance: number;
  readonly changedModules: readonly string[];
}

export interface UnresolvedModuleReference {
  readonly importer: string;
  readonly specifier: string;
}

export interface ImpactAnalysisIssue {
  readonly path: string;
  readonly reason: string;
}

export interface ImpactSummary {
  readonly sourceFiles: number;
  readonly changedModules: number;
  readonly dependencies: number;
  readonly directDependents: number;
  readonly transitiveDependents: number;
  readonly unresolvedReferences: number;
  readonly filesUnavailable: number;
}

export interface ImpactAnalysis {
  readonly changedModules: readonly string[];
  readonly dependencies: readonly ModuleDependency[];
  readonly impactedFiles: readonly ImpactedFile[];
  readonly unresolvedReferences: readonly UnresolvedModuleReference[];
  readonly issues: readonly ImpactAnalysisIssue[];
  readonly summary: ImpactSummary;
}

export interface CreateImpactAnalysisInput {
  readonly changedModules: readonly string[];
  readonly dependencies: readonly ModuleDependency[];
  readonly impactedFiles: readonly ImpactedFile[];
  readonly unresolvedReferences?: readonly UnresolvedModuleReference[];
  readonly issues?: readonly ImpactAnalysisIssue[];
  readonly sourceFiles: number;
}

/** 그래프 결과를 정렬·동결해 실행 순서와 무관한 보고서를 만든다. */
export function createImpactAnalysis(input: CreateImpactAnalysisInput): ImpactAnalysis {
  const changedModules = uniqueSorted(input.changedModules);
  const dependencies = uniqueDependencies(input.dependencies);
  const impactedFiles = uniqueImpactedFiles(input.impactedFiles);
  const unresolvedReferences = uniqueUnresolvedReferences(input.unresolvedReferences ?? []);
  const issues = [...(input.issues ?? [])]
    .map((issue) => Object.freeze({ ...issue }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return Object.freeze({
    changedModules: Object.freeze(changedModules),
    dependencies: Object.freeze(dependencies),
    impactedFiles: Object.freeze(impactedFiles),
    unresolvedReferences: Object.freeze(unresolvedReferences),
    issues: Object.freeze(issues),
    summary: Object.freeze({
      sourceFiles: input.sourceFiles,
      changedModules: changedModules.length,
      dependencies: dependencies.length,
      directDependents: impactedFiles.filter((file) => file.distance === 1).length,
      transitiveDependents: impactedFiles.filter((file) => file.distance > 1).length,
      unresolvedReferences: unresolvedReferences.length,
      filesUnavailable: issues.length,
    }),
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueDependencies(values: readonly ModuleDependency[]): Readonly<ModuleDependency>[] {
  const unique = new Map<string, Readonly<ModuleDependency>>();
  for (const value of values) {
    unique.set(
      `${value.importer}\0${value.imported}`,
      Object.freeze({ importer: value.importer, imported: value.imported }),
    );
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.importer.localeCompare(right.importer) || left.imported.localeCompare(right.imported),
  );
}

function uniqueImpactedFiles(values: readonly ImpactedFile[]): Readonly<ImpactedFile>[] {
  const unique = new Map<string, Readonly<ImpactedFile>>();
  for (const value of values) {
    if (!Number.isSafeInteger(value.distance) || value.distance < 1) {
      throw new Error(`Impact distance must be a positive integer: ${value.path}`);
    }
    if (unique.has(value.path)) {
      throw new Error(`Duplicate impacted file: ${value.path}`);
    }
    unique.set(
      value.path,
      Object.freeze({
        ...value,
        changedModules: Object.freeze(uniqueSorted(value.changedModules)),
      }),
    );
  }
  return [...unique.values()].sort(
    (left, right) => left.distance - right.distance || left.path.localeCompare(right.path),
  );
}

function uniqueUnresolvedReferences(
  values: readonly UnresolvedModuleReference[],
): Readonly<UnresolvedModuleReference>[] {
  const unique = new Map<string, Readonly<UnresolvedModuleReference>>();
  for (const value of values) {
    unique.set(
      `${value.importer}\0${value.specifier}`,
      Object.freeze({ importer: value.importer, specifier: value.specifier }),
    );
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.importer.localeCompare(right.importer) || left.specifier.localeCompare(right.specifier),
  );
}
