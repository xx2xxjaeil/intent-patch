import {
  createFindingSet,
  type Finding,
  type FindingEvidenceValue,
  type FindingSet,
} from "./finding.js";

export interface BaselineEntry {
  readonly ruleId: string;
  readonly file: string;
  readonly evidence: Readonly<Record<string, FindingEvidenceValue>>;
  readonly reason: string;
  /** Inclusive UTC date. The exception stops applying on the following day. */
  readonly expires: string;
}

export interface SuppressedFinding {
  readonly finding: Finding;
  readonly reason: string;
  readonly expires: string;
}

export interface BaselineResult {
  readonly findings: FindingSet;
  readonly suppressed: readonly SuppressedFinding[];
  readonly expired: readonly BaselineEntry[];
}

/** 정확한 rule/file/evidence에만 예외를 적용한다. 모호한 항목은 조용히 통과시키지 않는다. */
export function applyFindingBaseline(
  findings: FindingSet,
  entries: readonly BaselineEntry[],
  today: string,
): BaselineResult {
  const active = entries.filter((entry) => entry.expires >= today);
  const expired = entries.filter((entry) => entry.expires < today);
  const matches: Array<readonly [BaselineEntry, Finding]> = [];
  for (const entry of active) {
    const candidates = findings.items.filter((finding) => matchesEntry(entry, finding));
    if (candidates.length > 1) {
      throw new Error(
        `Baseline entry is ambiguous: ${entry.ruleId} in ${entry.file}; add evidence.`,
      );
    }
    const candidate = candidates[0];
    if (candidate !== undefined) matches.push([entry, candidate]);
  }
  const suppressedByFinding = new Map<Finding, BaselineEntry>();
  for (const [entry, finding] of matches) {
    if (suppressedByFinding.has(finding)) {
      throw new Error(`Multiple baseline entries match ${finding.ruleId} in ${finding.file}.`);
    }
    suppressedByFinding.set(finding, entry);
  }
  return {
    findings: createFindingSet(
      findings.items.filter((finding) => !suppressedByFinding.has(finding)),
    ),
    suppressed: findings.items.flatMap((finding) => {
      const entry = suppressedByFinding.get(finding);
      return entry === undefined ? [] : [{ finding, reason: entry.reason, expires: entry.expires }];
    }),
    expired,
  };
}

function matchesEntry(entry: BaselineEntry, finding: Finding): boolean {
  return (
    finding.ruleId === entry.ruleId &&
    finding.file === entry.file &&
    Object.entries(entry.evidence).every(([key, value]) => finding.evidence[key] === value)
  );
}
