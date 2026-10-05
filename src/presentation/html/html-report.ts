import type { FileChange, LineDelta } from "../../domain/change.js";
import type { ChangeContract } from "../../domain/change-contract.js";
import type { Finding } from "../../domain/finding.js";
import type { ImpactedFile } from "../../domain/impact.js";
import type { ChangeReport } from "../../domain/report.js";
import type { SymbolChange } from "../../domain/symbol-change.js";
import type { SourceTestCoverage } from "../../domain/test-change.js";

/** ChangeReport를 외부 리소스가 필요 없는 정적 HTML 문서로 변환한다. */
export function formatHtmlReport(report: ChangeReport): string {
  const target =
    report.target.headRef === undefined
      ? `${report.target.baseRef} → working tree`
      : `${report.target.baseRef} → ${report.target.headRef}`;
  const newDependencies = report.findings.items.filter((finding) =>
    finding.ruleId.startsWith("dependency/new-"),
  ).length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>IntentPatch · Change Report</title>
  <style>${styles}</style>
</head>
<body>
  <main class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">IntentPatch / deterministic analysis</p>
        <h1>Agent Change Report</h1>
        <p class="target">${escapeHtml(target)}</p>
      </div>
      <div class="report-state ${report.findings.summary.total === 0 ? "clear" : "attention"}">
        <span>${report.findings.summary.total === 0 ? "Clear" : "Review"}</span>
        <strong>${report.findings.summary.total} findings</strong>
      </div>
    </header>

    ${renderIntent(report.contract)}
    ${renderSummary(report, newDependencies)}
    ${renderSeverityBar(report)}
    ${renderContract(report.contract)}
    ${renderImpact(report.impact.changedModules, report.impact.impactedFiles)}
    ${renderFindings(report.findings.items)}
    ${renderTestCoverage(report.testChanges.sourceCoverage)}
    ${renderFiles(report.changes.files)}
    ${renderSymbols(report.symbolChanges.changes)}
    ${renderAnalysisNotes(report)}

    <footer>
      <span>IntentPatch</span>
      <span>Evidence over claims · LLM optional</span>
    </footer>
  </main>
</body>
</html>
`;
}

function renderIntent(contract: ChangeContract | undefined): string {
  if (contract?.intent === undefined) {
    return "";
  }
  return `<section class="intent" aria-label="Change intent">
      <span>REQUEST</span>
      <p>${escapeHtml(contract.intent)}</p>
    </section>`;
}

function renderSummary(report: ChangeReport, newDependencies: number): string {
  const { summary } = report.changes;
  const metrics = [
    ["Files changed", summary.filesChanged, "files"],
    ["Lines changed", `+${summary.additions} / -${summary.deletions}`, "diff"],
    ["Changed symbols", report.symbolChanges.summary.total, "symbols"],
    ["Direct impact", report.impact.summary.directDependents, "dependents"],
    ["Transitive impact", report.impact.summary.transitiveDependents, "dependents"],
    ["Tests changed", report.testChanges.summary.testsChanged, "tests"],
    ["Missing tests", report.testChanges.summary.sourceFilesWithoutTestChanges, "signals"],
    ["New dependencies", newDependencies, "packages"],
  ] as const;

  return `<section class="metrics" aria-label="Change summary">
      ${metrics
        .map(
          ([label, value, unit]) => `<article class="metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(value))}</strong>
        <small>${escapeHtml(unit)}</small>
      </article>`,
        )
        .join("\n      ")}
    </section>`;
}

function renderSeverityBar(report: ChangeReport): string {
  const { bySeverity } = report.findings.summary;
  return `<section class="severity-bar" aria-label="Finding severity summary">
      <span class="severity high"><i></i>High <strong>${bySeverity.high}</strong></span>
      <span class="severity medium"><i></i>Medium <strong>${bySeverity.medium}</strong></span>
      <span class="severity low"><i></i>Low <strong>${bySeverity.low}</strong></span>
    </section>`;
}

function renderContract(contract: ChangeContract | undefined): string {
  if (contract === undefined) {
    return "";
  }

  const budgets = [
    contract.scope.maxFiles === undefined ? undefined : `${contract.scope.maxFiles} files`,
    contract.scope.maxLines === undefined ? undefined : `${contract.scope.maxLines} lines`,
  ].filter((value): value is string => value !== undefined);
  const testPolicy = contract.tests;
  const rows = [
    ["Expected", contract.scope.include.join(", ") || "Not configured"],
    ["Allowed", contract.scope.allow.join(", ") || "None"],
    ["Budget", budgets.join(" · ") || "Not configured"],
    ...(testPolicy === undefined
      ? []
      : [
          ["Test sources", testPolicy.requireFor.join(", ")],
          ["Test files", testPolicy.include.join(", ")],
          ["Test excludes", testPolicy.exclude.join(", ") || "None"],
        ]),
  ];

  return renderSection(
    "Change contract",
    "Declared boundaries",
    `<dl class="contract-grid">${rows
      .map(
        ([label, value]) =>
          `<div><dt>${escapeHtml(label ?? "")}</dt><dd>${escapeHtml(value ?? "")}</dd></div>`,
      )
      .join("")}</dl>`,
  );
}

function renderFindings(findings: readonly Finding[]): string {
  const body =
    findings.length === 0
      ? renderEmpty("No potential issues were detected by the enabled rules.")
      : `<div class="finding-list">${findings
          .map(
            (finding) => `<article class="finding ${finding.severity}">
          <div class="finding-heading">
            <span>${escapeHtml(finding.severity)}</span>
            <div><h3>${escapeHtml(finding.title)}</h3><code>${escapeHtml(finding.file)}</code></div>
          </div>
          <p>${escapeHtml(finding.description)}</p>
          <details><summary>${escapeHtml(finding.ruleId)} · evidence</summary>
            <dl>${Object.entries(finding.evidence)
              .map(
                ([key, value]) =>
                  `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`,
              )
              .join("")}</dl>
          </details>
        </article>`,
          )
          .join("")}</div>`;

  return renderSection("Potential issues", `${findings.length} findings`, body);
}

function renderImpact(changedModules: readonly string[], files: readonly ImpactedFile[]): string {
  const body =
    files.length === 0
      ? renderEmpty("No dependent files were reached from changed modules.")
      : `${renderImpactGraph(changedModules, files)}
      <div class="impact-list">${files
        .map(
          (file) => `<article>
          <span class="distance">${file.distance === 1 ? "DIRECT" : `${file.distance} HOPS`}</span>
          <code>${escapeHtml(file.path)}</code>
          <small>from ${escapeHtml(file.changedModules.join(", "))}</small>
        </article>`,
        )
        .join("")}</div>`;

  return renderSection("Impact reach", `${files.length} affected files`, body);
}

function renderImpactGraph(
  changedModules: readonly string[],
  impactedFiles: readonly ImpactedFile[],
): string {
  const rowHeight = 64;
  const top = 54;
  const nodeHeight = 42;
  const height = Math.max(changedModules.length, impactedFiles.length) * rowHeight + 76;
  const moduleIndexes = new Map(changedModules.map((path, index) => [path, index]));
  const edges = impactedFiles.flatMap((file, fileIndex) =>
    file.changedModules.flatMap((module) => {
      const moduleIndex = moduleIndexes.get(module);
      if (moduleIndex === undefined) {
        return [];
      }
      const startY = top + moduleIndex * rowHeight + nodeHeight / 2;
      const endY = top + fileIndex * rowHeight + nodeHeight / 2;
      return [
        `<path class="graph-edge ${file.distance === 1 ? "direct" : "transitive"}" d="M 390 ${startY} C 480 ${startY}, 520 ${endY}, 610 ${endY}" />`,
      ];
    }),
  );

  return `<div class="impact-graph-wrap">
      <svg class="impact-graph" viewBox="0 0 1000 ${height}" role="img" aria-label="Dependency impact graph">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>
        <text class="graph-column-label" x="40" y="24">CHANGED MODULES</text>
        <text class="graph-column-label" x="610" y="24">AFFECTED FILES</text>
        ${edges.join("\n        ")}
        ${changedModules
          .map((path, index) => renderGraphNode(path, 40, top + index * rowHeight, "changed"))
          .join("\n        ")}
        ${impactedFiles
          .map((file, index) =>
            renderGraphNode(
              file.path,
              610,
              top + index * rowHeight,
              file.distance === 1 ? "direct" : "transitive",
            ),
          )
          .join("\n        ")}
      </svg>
    </div>`;
}

function renderGraphNode(path: string, x: number, y: number, kind: string): string {
  return `<g class="graph-node ${kind}"><title>${escapeHtml(path)}</title><rect x="${x}" y="${y}" width="350" height="42" rx="9"></rect><text x="${x + 16}" y="${y + 26}">${escapeHtml(shortenPath(path))}</text></g>`;
}

function shortenPath(path: string): string {
  const maximumLength = 46;
  if (path.length <= maximumLength) {
    return path;
  }
  const retainedLength = Math.floor((maximumLength - 1) / 2);
  return `${path.slice(0, retainedLength)}…${path.slice(-retainedLength)}`;
}

function renderTestCoverage(coverage: readonly SourceTestCoverage[]): string {
  if (coverage.length === 0) {
    return "";
  }
  return renderSection(
    "Test change signals",
    `${coverage.length} source files checked`,
    `<div class="table-wrap"><table>
      <thead><tr><th>Source</th><th>Change</th><th>Matching changed tests</th></tr></thead>
      <tbody>${coverage
        .map(
          (item) => `<tr>
          <td><code>${escapeHtml(item.sourcePath)}</code></td>
          <td>${renderTag(item.sourceChangeKind)}</td>
          <td class="${item.matchingTests.length === 0 ? "missing" : "matched"}">${
            item.matchingTests.length === 0
              ? "No matching change"
              : item.matchingTests.map((path) => `<code>${escapeHtml(path)}</code>`).join("<br>")
          }</td>
        </tr>`,
        )
        .join("")}</tbody>
    </table></div>`,
  );
}

function renderFiles(files: readonly FileChange[]): string {
  const body =
    files.length === 0
      ? renderEmpty("No changed files were found for this comparison.")
      : `<div class="table-wrap"><table>
      <thead><tr><th>File</th><th>Status</th><th>Line delta</th></tr></thead>
      <tbody>${files
        .map(
          (file) => `<tr>
          <td><code>${escapeHtml(file.previousPath === undefined ? file.path : `${file.previousPath} → ${file.path}`)}</code></td>
          <td>${renderTag(file.kind)}</td>
          <td>${escapeHtml(formatLineDelta(file.lines))}</td>
        </tr>`,
        )
        .join("")}</tbody>
    </table></div>`;

  return renderSection("Changed files", `${files.length} files`, body);
}

function renderSymbols(changes: readonly SymbolChange[]): string {
  if (changes.length === 0) {
    return "";
  }
  return renderSection(
    "Changed symbols",
    `${changes.length} declarations`,
    `<div class="table-wrap"><table>
      <thead><tr><th>Symbol</th><th>Kind</th><th>Change</th><th>Location</th></tr></thead>
      <tbody>${changes
        .map((change) => {
          const line = change.afterLine ?? change.beforeLine;
          const location = line === undefined ? change.path : `${change.path}:${line}`;
          return `<tr>
          <td><strong>${escapeHtml(change.name)}</strong></td>
          <td>${escapeHtml(change.symbolKind)}</td>
          <td>${renderTag(change.changeKind)}</td>
          <td><code>${escapeHtml(location)}</code></td>
        </tr>`;
        })
        .join("")}</tbody>
    </table></div>`,
  );
}

function renderAnalysisNotes(report: ChangeReport): string {
  const notes = [
    ...report.symbolChanges.issues.map((issue) => `Symbol · ${issue.path} · ${issue.reason}`),
    ...report.impact.issues.map((issue) => `Impact · ${issue.path} · ${issue.reason}`),
    ...report.impact.unresolvedReferences.map(
      (reference) => `Import · ${reference.importer} → ${reference.specifier}`,
    ),
  ];
  if (notes.length === 0) {
    return "";
  }
  return renderSection(
    "Analysis notes",
    `${notes.length} uncertainty signals`,
    `<ul class="notes">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`,
  );
}

function renderSection(title: string, eyebrow: string, body: string): string {
  return `<section class="panel">
      <div class="section-heading"><div><span>${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2></div></div>
      ${body}
    </section>`;
}

function renderEmpty(message: string): string {
  return `<p class="empty">${escapeHtml(message)}</p>`;
}

function renderTag(value: string): string {
  return `<span class="tag">${escapeHtml(value)}</span>`;
}

function formatLineDelta(lines: LineDelta): string {
  switch (lines.kind) {
    case "measured":
      return `+${lines.additions} / -${lines.deletions}`;
    case "binary":
      return "Binary";
    case "unavailable":
      return `Not measured · ${lines.reason}`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => htmlEntities[character] ?? character);
}

const htmlEntities: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const styles = `
:root { color-scheme: dark; --bg:#080a0f; --panel:#10141d; --panel-2:#151b26; --line:#252d3b; --text:#f4f6fb; --muted:#8d98aa; --cyan:#58e6d9; --violet:#a890ff; --high:#ff647c; --medium:#ffb45b; --low:#6d8cff; }
* { box-sizing:border-box; }
body { margin:0; background:radial-gradient(circle at 15% 0%,#172535 0,transparent 32rem),var(--bg); color:var(--text); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
.shell { width:min(1180px,calc(100% - 40px)); margin:0 auto; padding:64px 0 40px; }
.hero { display:flex; align-items:flex-end; justify-content:space-between; gap:32px; margin-bottom:28px; }
.eyebrow,.section-heading span { color:var(--cyan); font-size:12px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
h1 { margin:8px 0 10px; font-size:clamp(36px,7vw,72px); line-height:.98; letter-spacing:-.055em; }
.target { margin:0; color:var(--muted); font:14px ui-monospace,SFMono-Regular,Menlo,monospace; }
.report-state { min-width:150px; padding:18px 20px; border:1px solid var(--line); border-radius:16px; background:rgba(16,20,29,.82); }
.report-state span { display:block; color:var(--muted); font-size:11px; letter-spacing:.14em; text-transform:uppercase; }
.report-state strong { display:block; margin-top:5px; font-size:19px; }
.report-state.attention { border-color:color-mix(in srgb,var(--medium) 55%,var(--line)); }
.report-state.clear { border-color:color-mix(in srgb,var(--cyan) 55%,var(--line)); }
.intent { display:grid; grid-template-columns:90px 1fr; gap:18px; align-items:start; padding:20px 22px; border:1px solid #29404b; border-radius:16px; background:linear-gradient(105deg,rgba(88,230,217,.1),rgba(168,144,255,.06)); }
.intent span { color:var(--cyan); font-size:11px; font-weight:800; letter-spacing:.14em; }
.intent p { margin:0; font-size:18px; font-weight:650; }
.metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:18px 0 12px; }
.metric { min-height:124px; padding:18px; border:1px solid var(--line); border-radius:16px; background:linear-gradient(145deg,var(--panel-2),var(--panel)); }
.metric span { display:block; color:var(--muted); font-size:12px; }
.metric strong { display:block; margin-top:14px; font-size:27px; letter-spacing:-.035em; }
.metric small { color:#5e6a7d; font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
.severity-bar { display:flex; gap:20px; padding:14px 18px; border:1px solid var(--line); border-radius:14px; background:rgba(16,20,29,.78); }
.severity { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
.severity i { width:7px; height:7px; border-radius:50%; background:currentColor; }
.severity strong { color:var(--text); }
.severity.high { color:var(--high); }.severity.medium { color:var(--medium); }.severity.low { color:var(--low); }
.panel { margin-top:18px; padding:24px; border:1px solid var(--line); border-radius:18px; background:rgba(16,20,29,.88); box-shadow:0 18px 70px rgba(0,0,0,.12); }
.section-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
.section-heading span { color:var(--muted); font-size:10px; }
h2 { margin:5px 0 0; font-size:23px; letter-spacing:-.025em; }
h3 { margin:0; font-size:16px; }
.contract-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:1px; overflow:hidden; padding:1px; border-radius:12px; background:var(--line); }
.contract-grid div { padding:16px; background:var(--panel-2); }
.contract-grid dt { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
.contract-grid dd { margin:7px 0 0; overflow-wrap:anywhere; font:13px ui-monospace,SFMono-Regular,Menlo,monospace; }
.finding-list { display:grid; gap:10px; }
.finding { padding:18px; border:1px solid var(--line); border-left:3px solid var(--low); border-radius:12px; background:var(--panel-2); }
.finding.high { border-left-color:var(--high); }.finding.medium { border-left-color:var(--medium); }
.finding-heading { display:flex; gap:13px; align-items:flex-start; }
.finding-heading>span { min-width:64px; padding:5px 7px; border-radius:7px; background:#232b39; color:var(--muted); font-size:10px; font-weight:800; text-align:center; text-transform:uppercase; }
.finding code { display:block; margin-top:5px; color:var(--muted); }
.finding p { margin:14px 0; color:#c3cad6; line-height:1.55; }
details { color:var(--muted); font-size:12px; } summary { cursor:pointer; }
details dl { display:grid; gap:7px; margin:12px 0 0; } details dl div { display:grid; grid-template-columns:150px 1fr; gap:12px; } details dt { color:#667287; } details dd { margin:0; overflow-wrap:anywhere; color:#aeb7c6; }
.impact-list { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
.impact-list article { display:grid; grid-template-columns:70px 1fr; gap:5px 12px; padding:15px; border:1px solid var(--line); border-radius:11px; background:var(--panel-2); }
.impact-list .distance { grid-row:1/3; color:var(--violet); font-size:10px; font-weight:800; letter-spacing:.08em; }
.impact-list small { color:var(--muted); overflow-wrap:anywhere; }
.impact-graph-wrap { overflow-x:auto; margin-bottom:14px; border:1px solid var(--line); border-radius:12px; background:#0c1017; }
.impact-graph { display:block; width:100%; min-width:820px; height:auto; }
.graph-column-label { fill:#68758a; font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.12em; }
.graph-edge { fill:none; stroke:#56627a; stroke-width:1.5; marker-end:url(#arrow); }
#arrow path { fill:#7a879e; }
.graph-edge.direct { stroke:var(--cyan); }.graph-edge.transitive { stroke:var(--violet); stroke-dasharray:5 5; }
.graph-node rect { fill:#151b26; stroke:#303a4b; }.graph-node.changed rect { stroke:#537b7b; }.graph-node.direct rect { stroke:#3d716f; }.graph-node.transitive rect { stroke:#615787; }
.graph-node text { fill:#cbd5e5; font:12px ui-monospace,SFMono-Regular,Menlo,monospace; }
.table-wrap { overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { padding:10px 12px; border-bottom:1px solid var(--line); color:var(--muted); font-size:10px; letter-spacing:.1em; text-align:left; text-transform:uppercase; }
td { padding:14px 12px; border-bottom:1px solid #202735; vertical-align:top; } tbody tr:last-child td { border-bottom:0; }
code { overflow-wrap:anywhere; color:#c8d2e2; font:12px ui-monospace,SFMono-Regular,Menlo,monospace; }
.tag { display:inline-block; padding:4px 7px; border:1px solid #344052; border-radius:6px; color:#aeb9ca; font-size:10px; font-weight:750; letter-spacing:.06em; text-transform:uppercase; }
.missing { color:var(--medium); }.matched { color:var(--cyan); }
.notes { display:grid; gap:8px; margin:0; padding-left:18px; color:#b9c2d0; }
.empty { margin:0; padding:28px; border:1px dashed #303949; border-radius:12px; color:var(--muted); text-align:center; }
footer { display:flex; justify-content:space-between; padding:26px 4px 0; color:#536074; font-size:11px; letter-spacing:.05em; text-transform:uppercase; }
@media (max-width:760px) { .shell{width:min(100% - 24px,1180px);padding-top:32px}.hero{align-items:flex-start;flex-direction:column}.metrics{grid-template-columns:repeat(2,1fr)}.contract-grid,.impact-list{grid-template-columns:1fr}.severity-bar{flex-wrap:wrap}.panel{padding:18px}.intent{grid-template-columns:1fr}.report-state{width:100%} }
`;
