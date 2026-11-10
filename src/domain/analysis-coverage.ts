import type { ChangeSet } from "./change.js";
import type { ImpactAnalysis } from "./impact.js";
import type { SymbolChangeSet } from "./symbol-change.js";

/** 분석이 관찰한 범위와 확인 불가 항목이다. 규칙의 정확도나 테스트 커버리지가 아니다. */
export interface AnalysisCoverage {
  readonly changedFiles: number;
  readonly symbolFilesChecked: number;
  readonly symbolFilesUnavailable: number;
  readonly symbolFilesNotTargeted: number;
  readonly importGraphSourceFilesRead: number;
  readonly unresolvedImports: number;
  readonly importGraphIssues: number;
  readonly binaryFiles: number;
  readonly unmeasuredLineFiles: number;
}

export function createAnalysisCoverage(
  changes: ChangeSet,
  symbols: SymbolChangeSet,
  impact: ImpactAnalysis,
): AnalysisCoverage {
  const changedFiles = changes.summary.filesChanged;
  const symbolFilesChecked = symbols.summary.filesAnalyzed;
  const symbolFilesUnavailable = symbols.summary.filesUnavailable;
  const symbolFilesNotTargeted = changedFiles - symbolFilesChecked - symbolFilesUnavailable;
  if (symbolFilesNotTargeted < 0) {
    throw new Error("Symbol analysis counted more files than the Git change set contains.");
  }

  return Object.freeze({
    changedFiles,
    symbolFilesChecked,
    symbolFilesUnavailable,
    symbolFilesNotTargeted,
    importGraphSourceFilesRead: impact.summary.sourceFiles,
    unresolvedImports: impact.summary.unresolvedReferences,
    importGraphIssues: impact.issues.length,
    binaryFiles: changes.summary.binaryFiles,
    unmeasuredLineFiles: changes.summary.unmeasuredFiles,
  });
}
