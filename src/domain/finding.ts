export const severities = ["high", "medium", "low"] as const;

export type Severity = (typeof severities)[number];

export type FindingEvidenceValue = string | number | boolean;

/** 분석 규칙이 내린 판단과 재현 가능한 근거를 함께 보존한다. */
export interface Finding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
  readonly file: string;
  readonly evidence: Readonly<Record<string, FindingEvidenceValue>>;
}

export interface FindingSummary {
  readonly total: number;
  readonly bySeverity: Readonly<Record<Severity, number>>;
}

export interface FindingSet {
  readonly items: readonly Finding[];
  readonly summary: FindingSummary;
}

const severityRank: Readonly<Record<Severity, number>> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** 규칙 실행 순서와 관계없이 같은 보고서가 나오도록 finding을 정렬하고 집계한다. */
export function createFindingSet(findings: readonly Finding[]): FindingSet {
  const items = findings
    .map((finding) =>
      Object.freeze({ ...finding, evidence: Object.freeze({ ...finding.evidence }) }),
    )
    .sort(compareFindings);
  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0 };

  for (const finding of items) {
    bySeverity[finding.severity] += 1;
  }

  return Object.freeze({
    items: Object.freeze(items),
    summary: Object.freeze({ total: items.length, bySeverity: Object.freeze(bySeverity) }),
  });
}

export function isSeverityAtLeast(severity: Severity, threshold: Severity): boolean {
  return severityRank[severity] >= severityRank[threshold];
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    severityRank[right.severity] - severityRank[left.severity] ||
    left.file.localeCompare(right.file) ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.title.localeCompare(right.title)
  );
}
