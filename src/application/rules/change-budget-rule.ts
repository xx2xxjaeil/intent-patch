import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";

/** 명시된 변경 파일 수와 측정 가능한 라인 수 예산의 초과 여부를 판단한다. */
export class ChangeBudgetRule implements AnalysisRule {
  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    const scope = context.contract?.scope;
    if (scope === undefined) {
      return [];
    }

    const findings: Finding[] = [];
    const { summary } = context.changes;
    if (scope.maxFiles !== undefined && summary.filesChanged > scope.maxFiles) {
      findings.push({
        ruleId: "scope/file-budget-exceeded",
        severity: "low",
        title: "Changed file budget exceeded",
        description: `${summary.filesChanged} files changed; the configured maximum is ${scope.maxFiles}.`,
        file: ".",
        evidence: {
          actual: summary.filesChanged,
          maximum: scope.maxFiles,
        },
      });
    }

    const measuredLines = summary.additions + summary.deletions;
    if (scope.maxLines !== undefined && measuredLines > scope.maxLines) {
      findings.push({
        ruleId: "scope/line-budget-exceeded",
        severity: "low",
        title: "Changed line budget exceeded",
        description: `${measuredLines} measured lines changed; the configured maximum is ${scope.maxLines}.`,
        file: ".",
        evidence: {
          actual: measuredLines,
          maximum: scope.maxLines,
          additions: summary.additions,
          deletions: summary.deletions,
        },
      });
    }

    return findings;
  }
}
