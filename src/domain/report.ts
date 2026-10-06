import type { ChangeSet } from "./change.js";
import type { ChangeContract } from "./change-contract.js";
import type { CodeStructureAnalysis } from "./code-structure.js";
import type { FindingSet } from "./finding.js";
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
  readonly symbolChanges: SymbolChangeSet;
  readonly codeStructure: CodeStructureAnalysis;
  readonly impact: ImpactAnalysis;
  readonly testChanges: TestChangeAnalysis;
}
