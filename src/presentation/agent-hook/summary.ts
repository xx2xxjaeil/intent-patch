import type { ChangeReport } from "../../domain/report.js";

/** 요청문과 finding 설명 대신 변경·심각도 집계만 Hook 메시지에 표시한다. */
export function formatAgentHookSummary(report: ChangeReport): string | undefined {
  if (report.changes.summary.filesChanged === 0) return undefined;
  const { bySeverity, total } = report.findings.summary;
  return `IntentPatch: ${report.changes.summary.filesChanged} files changed; ${total} ${total === 1 ? "finding" : "findings"} (high ${bySeverity.high}, medium ${bySeverity.medium}, low ${bySeverity.low}).`;
}
