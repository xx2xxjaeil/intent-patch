import type { ChangeSet } from "./change.js";
import type { FindingSet } from "./finding.js";

export interface AnalysisTarget {
  readonly baseRef: string;
  readonly headRef?: string;
}

export interface ChangeReport {
  readonly target: AnalysisTarget;
  readonly changes: ChangeSet;
  readonly findings: FindingSet;
}
