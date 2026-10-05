import type { FileChangeKind } from "./change.js";

export interface TestFileChange {
  readonly path: string;
  readonly changeKind: FileChangeKind;
}

export interface SourceTestCoverage {
  readonly sourcePath: string;
  readonly sourceChangeKind: FileChangeKind;
  readonly matchingTests: readonly string[];
}

export interface TestChangeSummary {
  readonly testsChanged: number;
  readonly testsAdded: number;
  readonly testsDeleted: number;
  readonly sourceFilesChecked: number;
  readonly sourceFilesWithoutTestChanges: number;
}

export interface TestChangeAnalysis {
  readonly testFiles: readonly TestFileChange[];
  readonly sourceCoverage: readonly SourceTestCoverage[];
  readonly summary: TestChangeSummary;
}

export interface CreateTestChangeAnalysisInput {
  readonly testFiles: readonly TestFileChange[];
  readonly sourceCoverage: readonly SourceTestCoverage[];
}

/** 테스트 변경 사실을 정렬·동결하고 소스별 동반 변경 여부를 집계한다. */
export function createTestChangeAnalysis(input: CreateTestChangeAnalysisInput): TestChangeAnalysis {
  assertUniquePaths(
    input.testFiles.map((file) => file.path),
    "test file",
  );
  assertUniquePaths(
    input.sourceCoverage.map((coverage) => coverage.sourcePath),
    "source file",
  );

  const testFiles = input.testFiles
    .map((file) => Object.freeze({ ...file }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const sourceCoverage = input.sourceCoverage
    .map((coverage) =>
      Object.freeze({
        ...coverage,
        matchingTests: Object.freeze(
          [...new Set(coverage.matchingTests)].sort((left, right) => left.localeCompare(right)),
        ),
      }),
    )
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

  return Object.freeze({
    testFiles: Object.freeze(testFiles),
    sourceCoverage: Object.freeze(sourceCoverage),
    summary: Object.freeze({
      testsChanged: testFiles.length,
      testsAdded: testFiles.filter((file) => file.changeKind === "added").length,
      testsDeleted: testFiles.filter((file) => file.changeKind === "deleted").length,
      sourceFilesChecked: sourceCoverage.length,
      sourceFilesWithoutTestChanges: sourceCoverage.filter(
        (coverage) => coverage.matchingTests.length === 0,
      ).length,
    }),
  });
}

function assertUniquePaths(paths: readonly string[], description: string): void {
  const unique = new Set<string>();
  for (const path of paths) {
    if (unique.has(path)) {
      throw new Error(`Duplicate ${description}: ${path}`);
    }
    unique.add(path);
  }
}
