import type { ChangeSet } from "./change.js";
import type { ChangeContract } from "./change-contract.js";
import type { CodeStructureAnalysis } from "./code-structure.js";
import type { FindingSet } from "./finding.js";
import type { BaselineEntry, SuppressedFinding } from "./finding-baseline.js";
import type { ImpactAnalysis } from "./impact.js";
import type { SymbolChangeSet } from "./symbol-change.js";
import type { TestChangeAnalysis } from "./test-change.js";

export interface AnalysisTarget {
  readonly baseRef: string;
  readonly headRef?: string;
}

export interface ChangeReport {
  readonly target: AnalysisTarget;
  readonly contract?: ChangeContract;
  readonly changes: ChangeSet;
  readonly findings: FindingSet;
  readonly baseline?: Readonly<{
    suppressed: readonly SuppressedFinding[];
    expired: readonly BaselineEntry[];
  }>;
  readonly symbolChanges: SymbolChangeSet;
  readonly codeStructure: CodeStructureAnalysis;
  readonly impact: ImpactAnalysis;
  readonly testChanges: TestChangeAnalysis;
  /** 검토 편의를 위한 제한된 Git patch. 분석 규칙의 판단 근거로 사용하지 않는다. */
  readonly patchPreviews?: readonly PatchPreview[];
}

export interface PatchPreview {
  readonly path: string;
  readonly lines: readonly string[];
  readonly truncated: boolean;
  readonly unavailableReason?: string;
}
