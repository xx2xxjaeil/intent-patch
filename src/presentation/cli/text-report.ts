import type { FileChange, FileChangeKind, LineDelta } from "../../domain/change.js";
import type { ChangeContract } from "../../domain/change-contract.js";
import type { Finding } from "../../domain/finding.js";
import type { ImpactedFile } from "../../domain/impact.js";
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
  "re-export": "Re-export",
};

export function formatTextReport(report: ChangeReport): string {
  const { summary, files } = report.changes;
  const { items: findings, summary: findingSummary } = report.findings;
  const {
    changes: symbolChanges,
    issues: symbolIssues,
    summary: symbolSummary,
  } = report.symbolChanges;
  const {
    impactedFiles,
    unresolvedReferences,
    issues: impactIssues,
    summary: impactSummary,
  } = report.impact;
  const { summary: testSummary } = report.testChanges;
  const newDependencies = findings.filter((finding) =>
    finding.ruleId.startsWith("dependency/new-"),
  ).length;
  const riskyApiChanges = findings.filter((finding) => finding.ruleId.startsWith("api/")).length;
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
    `Import edges         ${impactSummary.dependencies}`,
    `Direct dependents    ${impactSummary.directDependents}`,
    `Transitive impact    ${impactSummary.transitiveDependents}`,
    `Unresolved imports   ${impactSummary.unresolvedReferences}`,
    `Tests changed        ${testSummary.testsChanged}`,
    `Tests added          ${testSummary.testsAdded}`,
    `Missing test changes ${testSummary.sourceFilesWithoutTestChanges}`,
    `New dependencies     ${newDependencies}`,
    `Risky API changes    ${riskyApiChanges}`,
    `Findings             ${findingSummary.total}`,
  ];

  if (report.contract !== undefined) {
    lines.push("", "Change contract", "");
    lines.push(...formatChangeContract(report.contract));
  }

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

  if (impactedFiles.length > 0) {
    lines.push("", "Impacted files", "");
    lines.push(...impactedFiles.flatMap(formatImpactedFile));
  }

  if (unresolvedReferences.length > 0) {
    lines.push("", "Unresolved relative imports", "");
    lines.push(
      ...unresolvedReferences.map(
        (reference) => `?  ${reference.importer} → ${reference.specifier}`,
      ),
    );
  }

  if (impactIssues.length > 0) {
    lines.push("", "Unavailable impact analysis", "");
    lines.push(...impactIssues.flatMap((issue) => [`!  ${issue.path}`, `   ${issue.reason}`]));
  }

  if (findings.length > 0) {
    lines.push("", "Potential issues", "");
    lines.push(...findings.flatMap((finding, index) => formatFinding(finding, index > 0)));
  }

  return `${lines.join("\n")}\n`;
}

function formatChangeContract(contract: ChangeContract): string[] {
  const budgets = [
    contract.scope.maxFiles === undefined ? undefined : `${contract.scope.maxFiles} files`,
    contract.scope.maxLines === undefined ? undefined : `${contract.scope.maxLines} measured lines`,
  ].filter((value): value is string => value !== undefined);

  const lines = [
    `Intent          ${contract.intent ?? "(not specified)"}`,
    `Expected paths  ${contract.scope.include.join(", ") || "(not configured)"}`,
    `Allowed paths   ${contract.scope.allow.join(", ") || "(none)"}`,
    `Budget          ${budgets.join(", ") || "(not configured)"}`,
  ];

  if (contract.tests !== undefined) {
    lines.push(
      `Test sources    ${contract.tests.requireFor.join(", ")}`,
      `Test files      ${contract.tests.include.join(", ")}`,
      `Test excludes   ${contract.tests.exclude.join(", ") || "(none)"}`,
    );
  }

  return lines;
}

function formatImpactedFile(file: ImpactedFile): string[] {
  const relationship = file.distance === 1 ? "direct" : `transitive · ${file.distance} hops`;
  return [
    `→  ${relationship.padEnd(20)}${file.path}`,
    `   changed: ${file.changedModules.join(", ")}`,
  ];
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
