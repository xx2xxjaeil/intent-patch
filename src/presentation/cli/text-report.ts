import type { FileChange, FileChangeKind, LineDelta } from "../../domain/change.js";
import type { Finding } from "../../domain/finding.js";
import type { ChangeReport } from "../../domain/report.js";

const statusLabels: Readonly<Record<FileChangeKind, string>> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  unmerged: "U",
  unknown: "?",
};

export function formatTextReport(report: ChangeReport): string {
  const { summary, files } = report.changes;
  const { items: findings, summary: findingSummary } = report.findings;
  const newDependencies = findings.filter((finding) =>
    finding.ruleId.startsWith("dependency/new-"),
  ).length;
  const target =
    report.target.headRef === undefined
      ? `${report.target.baseRef} → working tree`
      : `${report.target.baseRef} → ${report.target.headRef}`;

  const lines = [
    "IntentPatch Change Report",
    "",
    `Target               ${target}`,
    `Files changed        ${summary.filesChanged}`,
    `Lines                +${summary.additions} / -${summary.deletions}`,
    `Binary files         ${summary.binaryFiles}`,
    `Unmeasured files     ${summary.unmeasuredFiles}`,
    `New dependencies     ${newDependencies}`,
    `Findings             ${findingSummary.total}`,
  ];

  if (files.length > 0) {
    lines.push("", "Changed files", "");
    lines.push(...files.map(formatFile));
  }

  if (findings.length > 0) {
    lines.push("", "Potential issues", "");
    lines.push(...findings.flatMap((finding, index) => formatFinding(finding, index > 0)));
  }

  return `${lines.join("\n")}\n`;
}

function formatFinding(finding: Finding, addLeadingBlankLine: boolean): string[] {
  const lines = [
    `${finding.severity.toUpperCase().padEnd(8)}${finding.title}`,
    `        ${finding.file} · ${finding.ruleId}`,
    `        ${finding.description}`,
  ];
  return addLeadingBlankLine ? ["", ...lines] : lines;
}

function formatFile(file: FileChange): string {
  const source = file.previousPath === undefined ? "" : `${file.previousPath} → `;
  return `${statusLabels[file.kind]}  ${formatLineDelta(file.lines).padEnd(13)} ${source}${file.path}`;
}

function formatLineDelta(lines: LineDelta): string {
  switch (lines.kind) {
    case "measured":
      return `+${lines.additions} / -${lines.deletions}`;
    case "binary":
      return "binary";
    case "unavailable":
      return "not measured";
  }
}
