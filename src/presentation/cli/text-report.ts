import type { FileChange, FileChangeKind, LineDelta } from "../../domain/change.js";
import type { Finding } from "../../domain/finding.js";
import type { ChangeReport } from "../../domain/report.js";
import type {
  SourceSymbolKind,
  SymbolChange,
  SymbolChangeKind,
} from "../../domain/symbol-change.js";

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

const symbolStatusLabels: Readonly<Record<SymbolChangeKind, string>> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

const symbolKindLabels: Readonly<Record<SourceSymbolKind, string>> = {
  function: "Function",
  class: "Class",
  interface: "Interface",
  "type-alias": "Type",
};

export function formatTextReport(report: ChangeReport): string {
  const { summary, files } = report.changes;
  const { items: findings, summary: findingSummary } = report.findings;
  const {
    changes: symbolChanges,
    issues: symbolIssues,
    summary: symbolSummary,
  } = report.symbolChanges;
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
    `Changed symbols      ${symbolSummary.total}`,
    `Unparsed source      ${symbolSummary.filesUnavailable}`,
    `New dependencies     ${newDependencies}`,
    `Findings             ${findingSummary.total}`,
  ];

  if (files.length > 0) {
    lines.push("", "Changed files", "");
    lines.push(...files.map(formatFile));
  }

  if (symbolChanges.length > 0) {
    lines.push("", "Changed symbols", "");
    lines.push(...symbolChanges.map(formatSymbolChange));
  }

  if (symbolIssues.length > 0) {
    lines.push("", "Unavailable symbol analysis", "");
    lines.push(...symbolIssues.flatMap((issue) => [`!  ${issue.path}`, `   ${issue.reason}`]));
  }

  if (findings.length > 0) {
    lines.push("", "Potential issues", "");
    lines.push(...findings.flatMap((finding, index) => formatFinding(finding, index > 0)));
  }

  return `${lines.join("\n")}\n`;
}

function formatSymbolChange(change: SymbolChange): string {
  const line = change.afterLine ?? change.beforeLine;
  const location = line === undefined ? change.path : `${change.path}:${line}`;
  return [
    symbolStatusLabels[change.changeKind],
    symbolKindLabels[change.symbolKind].padEnd(12),
    change.name.padEnd(28),
    location,
  ].join("  ");
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
