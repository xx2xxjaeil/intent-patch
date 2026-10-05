import type { ChangeSet } from "./change.js";

export interface AnalysisTarget {
  readonly baseRef: string;
  readonly headRef?: string;
}

export interface ChangeReport {
  readonly target: AnalysisTarget;
  readonly changes: ChangeSet;
}
