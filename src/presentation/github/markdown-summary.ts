import type { Finding } from "../../domain/finding.js";
import type { ChangeReport } from "../../domain/report.js";

const maximumDisplayedFindings = 50;

/** GitHub job summary에 표시할 크기 제한이 있는 Markdown 보고서를 만든다. */
export function formatGitHubSummary(report: ChangeReport): string {
  const { summary: changeSummary } = report.changes;
  const { summary: findingSummary } = report.findings;
  const target = `${report.target.baseRef} → ${report.target.headRef ?? "working tree"}`;
  const lines = [
    "## IntentPatch Change Report",
    "",
    `**Target:** ${escapeMarkdown(target)}`,
    "",
    "| Metric | Result |",
    "| --- | ---: |",
    `| Files changed | ${changeSummary.filesChanged} |`,
    `| Lines | +${changeSummary.additions} / -${changeSummary.deletions} |`,
    `| Direct dependents | ${report.impact.summary.directDependents} |`,
    `| Transitive impact | ${report.impact.summary.transitiveDependents} |`,
    `| Tests changed | ${report.testChanges.summary.testsChanged} |`,
    `| Missing test changes | ${report.testChanges.summary.sourceFilesWithoutTestChanges} |`,
    `| Findings | ${findingSummary.total} |`,
    `| High / Medium / Low | ${findingSummary.bySeverity.high} / ${findingSummary.bySeverity.medium} / ${findingSummary.bySeverity.low} |`,
  ];

  if (report.findings.items.length === 0) {
    lines.push("", "### Potential issues", "", "No potential issues were detected.");
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "",
    "### Potential issues",
    "",
    "| Severity | Finding | File | Rule |",
    "| --- | --- | --- | --- |",
    ...report.findings.items.slice(0, maximumDisplayedFindings).map(formatFindingRow),
  );

  const hiddenFindings = report.findings.items.length - maximumDisplayedFindings;
  if (hiddenFindings > 0) {
    lines.push("", `${hiddenFindings} additional findings are available in the report artifact.`);
  }
  return `${lines.join("\n")}\n`;
}

function formatFindingRow(finding: Finding): string {
  return `| ${finding.severity.toUpperCase()} | ${escapeMarkdown(finding.title)} | ${escapeMarkdown(finding.file)} | ${escapeMarkdown(finding.ruleId)} |`;
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("`", "&#96;")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}
