import { traceIntentToFiles } from "../../application/services/trace-intent-to-files.js";
import type { FileChange, LineDelta } from "../../domain/change.js";
import type { ChangeContract } from "../../domain/change-contract.js";
import type { Finding } from "../../domain/finding.js";
import type { ImpactedFile } from "../../domain/impact.js";
import type { ChangeReport, PatchPreview } from "../../domain/report.js";
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
  const riskyApiChanges = report.findings.items.filter((finding) =>
    finding.ruleId.startsWith("api/"),
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
    ${renderSummary(report, newDependencies, riskyApiChanges)}
    ${renderSeverityBar(report)}
    ${renderReportControls()}
    ${renderContract(report.contract)}
    ${renderIntentTrace(report.contract, report.changes.files)}
    ${renderImpact(report.impact.changedModules, report.impact.impactedFiles, report.changes.files)}
    ${renderFindings(report.findings.items, report.patchPreviews ?? [])}
    ${renderBaseline(report)}
    ${renderPatchPreviews(report.patchPreviews ?? [], report.changes.files.length)}
    ${renderTestCoverage(report.testChanges.sourceCoverage)}
    ${renderFiles(report.changes.files)}
    ${renderSymbols(report.symbolChanges.changes)}
    ${renderAnalysisNotes(report)}

    <footer>
      <span>IntentPatch</span>
      <span>Evidence over claims · LLM optional</span>
    </footer>
  </main>
  <script>${reportScript}</script>
</body>
</html>
`.replace(/[ \t]+$/gmu, "");
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

function renderBaseline(report: ChangeReport): string {
  const baseline = report.baseline;
  if (baseline === undefined) return "";
  const suppressed = baseline.suppressed
    .map(
      ({ finding, reason, expires }) =>
        `<li><strong>${escapeHtml(finding.title)}</strong> · ${escapeHtml(finding.file)}<br>${escapeHtml(reason)} · through ${escapeHtml(expires)}</li>`,
    )
    .join("");
  const expired = baseline.expired
    .map(
      ({ ruleId, file, reason, expires }) =>
        `<li><strong>Expired: ${escapeHtml(ruleId)}</strong> · ${escapeHtml(file)}<br>${escapeHtml(reason)} · expired ${escapeHtml(expires)}</li>`,
    )
    .join("");
  return renderSection(
    "Accepted exceptions",
    "BASELINE",
    `<p>${baseline.suppressed.length} suppressed · ${baseline.expired.length} expired</p>${suppressed === "" && expired === "" ? "" : `<ul class="notes">${suppressed}${expired}</ul>`}`,
  );
}

function renderSummary(
  report: ChangeReport,
  newDependencies: number,
  riskyApiChanges: number,
): string {
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
    ["Risky API changes", riskyApiChanges, "public APIs"],
    [
      "Structure signals",
      report.codeStructure.summary.duplicateCandidates +
        report.codeStructure.summary.singleImplementationAbstractions,
      "review candidates",
    ],
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

function renderReportControls(): string {
  return `<div class="report-controls" id="report-controls" hidden>
      <label for="path-filter">Filter file path</label>
      <input id="path-filter" type="search" placeholder="e.g. src/api" autocomplete="off">
      <div class="severity-filters"><span>Severity</span>
        <button type="button" data-severity-filter="all" aria-pressed="true">All</button>
        <button type="button" data-severity-filter="high" aria-pressed="false">High</button>
        <button type="button" data-severity-filter="medium" aria-pressed="false">Medium</button>
        <button type="button" data-severity-filter="low" aria-pressed="false">Low</button>
      </div>
      <span id="visible-count" role="status" aria-live="polite"></span>
    </div>`;
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
          ...Object.entries(testPolicy.related ?? {}).map(([source, tests]) => [
            `Related · ${source}`,
            tests.join(", "),
          ]),
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

function renderIntentTrace(
  contract: ChangeContract | undefined,
  files: readonly FileChange[],
): string {
  if (contract === undefined) return "";
  const traces = traceIntentToFiles(contract, files);
  const groups = [
    { relation: "expected", label: "Expected scope", note: "Matched scope.include" },
    { relation: "allowed", label: "Allowed scope", note: "Matched scope.allow" },
    { relation: "outside", label: "Outside scope", note: "No declared path matched" },
    { relation: "unclassified", label: "Unclassified", note: "Expected paths not configured" },
  ] as const;
  const columns = groups.flatMap((group) => {
    const matches = traces.filter((trace) => trace.relation === group.relation);
    if (matches.length === 0) return [];
    return [
      `<div class="intent-trace-group ${group.relation}" data-intent-group>
      <h3>${group.label} <small data-intent-count>${matches.length}</small></h3>
      <p>${group.note}</p>
      <ul>${matches
        .map((trace) => {
          const fileIndex = files.findIndex((file) => file.path === trace.path);
          return `<li data-report-path="${escapeHtml(trace.path)}"><a href="#file-${fileIndex}">${escapeHtml(trace.path)}</a>${trace.patterns.length === 0 ? "" : `<small>${escapeHtml(trace.patterns.join(", "))}</small>`}</li>`;
        })
        .join("")}</ul>
    </div>`,
    ];
  });
  const root = contract.intent === undefined ? "Declared change" : contract.intent;
  return renderSection(
    "Request → changed files",
    "Contract path evidence",
    `<div class="intent-trace">
    <div class="intent-trace-root"><span>REQUEST</span><strong>${escapeHtml(root)}</strong></div>
    <div class="intent-trace-groups">${columns.join("") || renderEmpty("No changed files were found.")}</div>
  </div><p class="intent-trace-note">Connections show declared path matches, not inferred natural-language intent.</p>`,
  );
}

function renderFindings(findings: readonly Finding[], previews: readonly PatchPreview[]): string {
  const body =
    findings.length === 0
      ? renderEmpty("No potential issues were detected by the enabled rules.")
      : `<div class="finding-list">${findings
          .map(
            (
              finding,
            ) => `<article class="finding ${finding.severity}" data-report-path="${escapeHtml(finding.file)}" data-finding-severity="${finding.severity}">
          <div class="finding-heading">
            <span>${escapeHtml(finding.severity)}</span>
            <div><h3>${escapeHtml(finding.title)}</h3><code>${escapeHtml(finding.file)}</code></div>
          </div>
          <p>${escapeHtml(finding.description)}</p>
          ${renderPatchLink(finding.file, previews)}
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

function renderPatchLink(path: string, previews: readonly PatchPreview[]): string {
  const index = previews.findIndex((preview) => preview.path === path);
  return index < 0 ? "" : `<a class="patch-link" href="#diff-${index}">Review file diff →</a>`;
}

function renderPatchPreviews(previews: readonly PatchPreview[], totalFiles: number): string {
  if (previews.length === 0) return "";
  const body = `<p class="patch-note">Only the first ${previews.length} of ${totalFiles} changed files and up to 160 lines per file are shown. These previews are review context, not rule evidence.</p>
    <div class="patch-list">${previews
      .map(
        (
          preview,
          index,
        ) => `<article id="diff-${index}" class="patch-card" data-report-path="${escapeHtml(preview.path)}">
        <h3>${escapeHtml(preview.path)}</h3>
        ${
          preview.unavailableReason === undefined
            ? `<pre aria-label="Git diff for ${escapeHtml(preview.path)}"><code>${preview.lines
                .map((line) => `<span class="${patchLineKind(line)}">${escapeHtml(line)}</span>`)
                .join("\n")}</code></pre>`
            : `<p>${escapeHtml(preview.unavailableReason)}</p>`
        }
        ${preview.truncated ? "<p>Preview truncated; use Git for the complete diff.</p>" : ""}
      </article>`,
      )
      .join("")}</div>`;
  return renderSection("Diff context", `${previews.length} file previews`, body);
}

function patchLineKind(line: string): string {
  if (line.startsWith("@@")) return "patch-hunk";
  if (line.startsWith("+")) return "patch-add";
  if (line.startsWith("-")) return "patch-remove";
  return "patch-context";
}

function renderImpact(
  changedModules: readonly string[],
  files: readonly ImpactedFile[],
  changes: readonly FileChange[],
): string {
  const body =
    files.length === 0
      ? renderEmpty("No dependent files were reached from changed modules.")
      : `${renderImpactGraph(changedModules, files, changes)}
      <div class="impact-list">${files
        .map(
          (
            file,
            index,
          ) => `<article id="impact-${index}" data-report-path="${escapeHtml(file.path)}">
          <span class="distance">${file.distance === 1 ? "DIRECT" : `${file.distance} HOPS`}</span>
          <code>${escapeHtml(file.path)}</code>
          <small>from ${escapeHtml(file.changedModules.join(", "))}${file.viaPreviousImports ? " · previous imports" : ""}</small>
        </article>`,
        )
        .join("")}</div>`;

  return renderSection("Impact reach", `${files.length} affected files`, body);
}

function renderImpactGraph(
  changedModules: readonly string[],
  impactedFiles: readonly ImpactedFile[],
  changes: readonly FileChange[],
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
        `<path class="graph-edge ${file.distance === 1 ? "direct" : "transitive"}${file.viaPreviousImports ? " previous" : ""}" data-graph-from="${escapeHtml(module)}" data-graph-to="${escapeHtml(file.path)}" d="M 390 ${startY} C 480 ${startY}, 520 ${endY}, 610 ${endY}" />`,
      ];
    }),
  );

  return `<div class="impact-graph-controls" aria-label="Graph navigation">
      <span>Drag to move · arrow keys to pan</span>
      <button type="button" data-graph-action="in" aria-label="Zoom in">+</button>
      <button type="button" data-graph-action="out" aria-label="Zoom out">−</button>
      <button type="button" data-graph-action="reset">Reset view</button>
      <span id="graph-visible-count" role="status" aria-live="polite"></span>
    </div>
    <div class="impact-graph-wrap">
      <svg class="impact-graph" viewBox="0 0 1000 ${height}" data-graph-height="${height}" role="group" aria-label="Dependency impact graph" tabindex="0">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>
        <text class="graph-column-label" x="40" y="24">CHANGED MODULES</text>
        <text class="graph-column-label" x="610" y="24">AFFECTED FILES</text>
        ${edges.join("\n        ")}
        ${changedModules
          .map((path, index) => {
            const fileIndex = changes.findIndex((file) => file.path === path);
            return renderGraphNode(
              path,
              40,
              top + index * rowHeight,
              "changed",
              fileIndex < 0 ? undefined : `file-${fileIndex}`,
            );
          })
          .join("\n        ")}
        ${impactedFiles
          .map((file, index) =>
            renderGraphNode(
              file.path,
              610,
              top + index * rowHeight,
              file.distance === 1 ? "direct" : "transitive",
              `impact-${index}`,
            ),
          )
          .join("\n        ")}
      </svg>
    </div>`;
}

function renderGraphNode(
  path: string,
  x: number,
  y: number,
  kind: string,
  target?: string,
): string {
  const node = `<g class="graph-node ${kind}"><title>${escapeHtml(path)}</title><rect x="${x}" y="${y}" width="350" height="42" rx="9"></rect><text x="${x + 16}" y="${y + 26}">${escapeHtml(shortenPath(path))}</text></g>`;
  return target === undefined
    ? `<g data-graph-path="${escapeHtml(path)}">${node}</g>`
    : `<a data-graph-path="${escapeHtml(path)}" href="#${target}" aria-label="Jump to ${escapeHtml(path)}">${node}</a>`;
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
          (file, index) => `<tr id="file-${index}" data-report-path="${escapeHtml(file.path)}">
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
    ...report.codeStructure.issues.map((issue) => `Structure · ${issue.path} · ${issue.reason}`),
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

// 사용자 입력을 실행 코드에 삽입하지 않는다. 필터는 HTML의 이스케이프된 data 속성만 읽는다.
const reportScript = `(() => {
  const controls = document.getElementById("report-controls");
  const input = document.getElementById("path-filter");
  const status = document.getElementById("visible-count");
  if (!controls || !input || !status) return;
  controls.hidden = false;
  let severity = "all";
  const entries = [...document.querySelectorAll("[data-report-path]")];
  const buttons = [...document.querySelectorAll("[data-severity-filter]")];
  const graph = document.querySelector(".impact-graph");
  const graphNodes = [...document.querySelectorAll("[data-graph-path]")];
  const graphEdges = [...document.querySelectorAll("[data-graph-from]")];
  const graphStatus = document.getElementById("graph-visible-count");
  const intentGroups = [...document.querySelectorAll("[data-intent-group]")];
  function update() {
    const path = input.value.trim().toLocaleLowerCase();
    let findings = 0;
    const findingPaths = new Set();
    for (const entry of entries) {
      const matchesPath = entry.getAttribute("data-report-path").toLocaleLowerCase().includes(path);
      const findingSeverity = entry.getAttribute("data-finding-severity");
      entry.hidden = !matchesPath || (findingSeverity !== null && severity !== "all" && severity !== findingSeverity);
      if (!entry.hidden && findingSeverity !== null) {
        findings++;
        findingPaths.add(entry.getAttribute("data-report-path"));
      }
    }
    for (const group of intentGroups) {
      const count = [...group.querySelectorAll("li[data-report-path]")].filter((item) => !item.hidden).length;
      group.hidden = count === 0;
      const label = group.querySelector("[data-intent-count]");
      if (label) label.textContent = String(count);
    }
    status.textContent = [findings, "findings shown"].join(" ");
    const visiblePaths = new Set();
    for (const node of graphNodes) {
      const name = node.getAttribute("data-graph-path");
      node.hidden = !name.toLocaleLowerCase().includes(path) ||
        (severity !== "all" && !findingPaths.has(name));
      if (!node.hidden) visiblePaths.add(name);
    }
    for (const edge of graphEdges) {
      edge.hidden = !visiblePaths.has(edge.getAttribute("data-graph-from")) ||
        !visiblePaths.has(edge.getAttribute("data-graph-to"));
    }
    if (graphStatus) graphStatus.textContent = [visiblePaths.size, "graph files shown"].join(" ");
  }
  input.addEventListener("input", update);
  for (const button of buttons) {
    button.addEventListener("click", () => {
      severity = button.getAttribute("data-severity-filter");
      for (const item of buttons) item.setAttribute("aria-pressed", String(item === button));
      update();
    });
  }
  for (const link of document.querySelectorAll(".impact-graph a[href^='#']")) {
    link.addEventListener("click", () => { input.value = ""; update(); });
  }
  if (graph) {
    const fullHeight = Number(graph.getAttribute("data-graph-height"));
    let view = { x: 0, y: 0, w: 1000, h: fullHeight };
    let pointer = null;
    function setView(x, y, width) {
      const w = Math.max(250, Math.min(1000, width));
      const h = fullHeight * w / 1000;
      view = {
        x: Math.max(0, Math.min(1000 - w, x)),
        y: Math.max(0, Math.min(fullHeight - h, y)),
        w, h,
      };
      graph.setAttribute("viewBox", [view.x, view.y, view.w, view.h].join(" "));
    }
    function zoom(factor) {
      const nextWidth = view.w * factor;
      setView(view.x + (view.w - nextWidth) / 2, view.y + (view.h - fullHeight * nextWidth / 1000) / 2, nextWidth);
    }
    for (const button of document.querySelectorAll("[data-graph-action]")) {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-graph-action");
        if (action === "reset") setView(0, 0, 1000);
        else zoom(action === "in" ? 0.75 : 1.25);
      });
    }
    graph.addEventListener("pointerdown", (event) => {
      if (event.target.closest("a")) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
      graph.setPointerCapture(event.pointerId);
    });
    graph.addEventListener("pointermove", (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      setView(pointer.viewX - (event.clientX - pointer.x) * view.w / graph.clientWidth,
        pointer.viewY - (event.clientY - pointer.y) * view.h / graph.clientHeight, view.w);
    });
    graph.addEventListener("pointerup", () => { pointer = null; });
    graph.addEventListener("pointercancel", () => { pointer = null; });
    graph.addEventListener("keydown", (event) => {
      const step = Math.max(20, view.w / 8);
      if (event.key === "+" || event.key === "=") zoom(0.75);
      else if (event.key === "-") zoom(1.25);
      else if (event.key === "ArrowLeft") setView(view.x - step, view.y, view.w);
      else if (event.key === "ArrowRight") setView(view.x + step, view.y, view.w);
      else if (event.key === "ArrowUp") setView(view.x, view.y - step, view.w);
      else if (event.key === "ArrowDown") setView(view.x, view.y + step, view.w);
      else return;
      event.preventDefault();
    });
  }
  update();
})();`;

const styles = `
:root { color-scheme: dark; --bg:#080a0f; --panel:#10141d; --panel-2:#151b26; --line:#252d3b; --text:#f4f6fb; --muted:#8d98aa; --cyan:#58e6d9; --violet:#a890ff; --high:#ff647c; --medium:#ffb45b; --low:#6d8cff; }
* { box-sizing:border-box; }
.report-controls[hidden], [data-report-path][hidden], .impact-graph [hidden] { display:none; }
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
.metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; margin:18px 0 12px; }
.metric { min-height:124px; padding:18px; border:1px solid var(--line); border-radius:16px; background:linear-gradient(145deg,var(--panel-2),var(--panel)); }
.metric span { display:block; color:var(--muted); font-size:12px; }
.metric strong { display:block; margin-top:14px; font-size:27px; letter-spacing:-.035em; }
.metric small { color:#5e6a7d; font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
.severity-bar { display:flex; gap:20px; padding:14px 18px; border:1px solid var(--line); border-radius:14px; background:rgba(16,20,29,.78); }
.severity { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
.severity i { width:7px; height:7px; border-radius:50%; background:currentColor; }
.severity strong { color:var(--text); }
.severity.high { color:var(--high); }.severity.medium { color:var(--medium); }.severity.low { color:var(--low); }
.report-controls { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-top:12px; padding:12px 16px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
.report-controls label { color:var(--muted); font-size:12px; }
.report-controls input { min-width:190px; flex:1; padding:8px 10px; border:1px solid #344052; border-radius:7px; background:#0c1017; color:var(--text); }
.severity-filters { display:flex; gap:4px; }
.severity-filters>span { align-self:center; margin-right:3px; color:var(--muted); font-size:11px; }
.severity-filters button { padding:8px 10px; border:1px solid #344052; border-radius:7px; background:#151b26; color:var(--muted); cursor:pointer; }
.severity-filters button[aria-pressed="true"] { border-color:var(--cyan); color:var(--cyan); }
#visible-count { color:var(--muted); font-size:11px; white-space:nowrap; }
.panel { margin-top:18px; padding:24px; border:1px solid var(--line); border-radius:18px; background:rgba(16,20,29,.88); box-shadow:0 18px 70px rgba(0,0,0,.12); }
.section-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
.section-heading span { color:var(--muted); font-size:10px; }
h2 { margin:5px 0 0; font-size:23px; letter-spacing:-.025em; }
h3 { margin:0; font-size:16px; }
code { overflow-wrap:anywhere; color:#c8d2e2; font:12px ui-monospace,SFMono-Regular,Menlo,monospace; }
details { color:var(--muted); font-size:12px; } summary { cursor:pointer; }
details dl { display:grid; gap:7px; margin:12px 0 0; } details dl div { display:grid; grid-template-columns:150px 1fr; gap:12px; } details dt { color:#667287; } details dd { margin:0; overflow-wrap:anywhere; color:#aeb7c6; }
.contract-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:1px; overflow:hidden; padding:1px; border-radius:12px; background:var(--line); }
.contract-grid div { padding:16px; background:var(--panel-2); }
.contract-grid dt { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
.contract-grid dd { margin:7px 0 0; overflow-wrap:anywhere; font:13px ui-monospace,SFMono-Regular,Menlo,monospace; }
.intent-trace { display:grid; grid-template-columns:minmax(170px,1fr) 3fr; gap:22px; align-items:start; }
.intent-trace-root,.intent-trace-group { padding:16px; border:1px solid var(--line); border-radius:12px; background:var(--panel-2); }
.intent-trace-root { border-color:var(--cyan); overflow-wrap:anywhere; }
.intent-trace-root span { display:block; margin-bottom:8px; color:var(--cyan); font-size:10px; font-weight:800; letter-spacing:.14em; }
.intent-trace-root strong { font-size:15px; }
.intent-trace-groups { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:12px; border-left:2px solid var(--line); padding-left:20px; }
.intent-trace-group { position:relative; }
.intent-trace-group::before { content:""; position:absolute; width:20px; height:2px; left:-21px; top:29px; background:var(--line); }
.intent-trace-group.outside { border-color:var(--medium); }
.intent-trace-group h3 small { color:var(--muted); font-size:12px; }
.intent-trace-group p,.intent-trace-note { color:var(--muted); font-size:12px; }
.intent-trace-group ul { padding:0; margin:12px 0 0; list-style:none; }
.intent-trace-group li { padding:8px 0; border-top:1px solid var(--line); overflow-wrap:anywhere; }
.intent-trace-group li a { color:var(--text); font:12px ui-monospace,SFMono-Regular,Menlo,monospace; }
.intent-trace-group li small { display:block; margin-top:4px; color:var(--muted); }
.finding-list { display:grid; gap:10px; }
.finding { padding:18px; border:1px solid var(--line); border-left:3px solid var(--low); border-radius:12px; background:var(--panel-2); }
.finding.high { border-left-color:var(--high); }.finding.medium { border-left-color:var(--medium); }
.finding-heading { display:flex; gap:13px; align-items:flex-start; }
.finding-heading>span { min-width:64px; padding:5px 7px; border-radius:7px; background:#232b39; color:var(--muted); font-size:10px; font-weight:800; text-align:center; text-transform:uppercase; }
.finding code { display:block; margin-top:5px; color:var(--muted); }
.finding p { margin:14px 0; color:#c3cad6; line-height:1.55; }
.patch-link { display:inline-block; margin:0 0 12px; color:var(--cyan); font-size:12px; font-weight:700; text-decoration:none; }
.patch-link:hover { text-decoration:underline; }
.patch-note { color:var(--muted); font-size:12px; line-height:1.5; }
.patch-list { display:grid; gap:12px; }
.patch-card { overflow:hidden; border:1px solid var(--line); border-radius:12px; background:var(--panel-2); scroll-margin-top:20px; }
.patch-card:target { border-color:var(--cyan); }
.patch-card h3 { margin:0; padding:12px 16px; font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
.patch-card p { margin:0; padding:12px 16px; color:var(--muted); }
.patch-card pre { overflow:auto; margin:0; padding:12px 16px; border-top:1px solid var(--line); font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
.patch-card pre span { display:block; white-space:pre; }
.patch-add { color:#89d9a0; background:#143322; }
.patch-remove { color:#ff9aa8; background:#3c1e28; }
.patch-hunk { color:var(--cyan); }
.impact-list { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
.impact-list article { display:grid; grid-template-columns:70px 1fr; gap:5px 12px; padding:15px; border:1px solid var(--line); border-radius:11px; background:var(--panel-2); }
.impact-list .distance { grid-row:1/3; color:var(--violet); font-size:10px; font-weight:800; letter-spacing:.08em; }
.impact-list small { color:var(--muted); overflow-wrap:anywhere; }
.impact-graph-controls { display:flex; align-items:center; gap:8px; margin-bottom:10px; color:var(--muted); font-size:12px; }
.impact-graph-controls span:first-child { margin-right:auto; }
.impact-graph-controls button { padding:5px 9px; border:1px solid var(--line); border-radius:6px; background:var(--panel-2); color:var(--text); cursor:pointer; }
.impact-graph-wrap { overflow-x:auto; margin-bottom:14px; border:1px solid var(--line); border-radius:12px; background:#0c1017; }
.impact-graph { display:block; width:100%; min-width:820px; height:min(560px,65vh); min-height:260px; cursor:grab; }
.impact-graph:active { cursor:grabbing; }
.graph-column-label { fill:#68758a; font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.12em; }
.graph-edge { fill:none; stroke:#56627a; stroke-width:1.5; marker-end:url(#arrow); }
#arrow path { fill:#7a879e; }
.graph-edge.direct { stroke:var(--cyan); }.graph-edge.transitive { stroke:var(--violet); stroke-dasharray:5 5; }
.graph-edge.previous { stroke:var(--medium); stroke-dasharray:3 4; }
.graph-node rect { fill:#151b26; stroke:#303a4b; }.graph-node.changed rect { stroke:#537b7b; }.graph-node.direct rect { stroke:#3d716f; }.graph-node.transitive rect { stroke:#615787; }
.graph-node text { fill:#cbd5e5; font:12px ui-monospace,SFMono-Regular,Menlo,monospace; }
.impact-graph a { cursor:pointer; }.impact-graph a:hover rect { stroke:var(--cyan); stroke-width:2; }
.impact-list article:target,tbody tr:target { outline:2px solid var(--cyan); outline-offset:-2px; }
.table-wrap { overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { padding:10px 12px; border-bottom:1px solid var(--line); color:var(--muted); font-size:10px; letter-spacing:.1em; text-align:left; text-transform:uppercase; }
td { padding:14px 12px; border-bottom:1px solid #202735; vertical-align:top; } tbody tr:last-child td { border-bottom:0; }
.tag { display:inline-block; padding:4px 7px; border:1px solid #344052; border-radius:6px; color:#aeb9ca; font-size:10px; font-weight:750; letter-spacing:.06em; text-transform:uppercase; }
.missing { color:var(--medium); }.matched { color:var(--cyan); }
.notes { display:grid; gap:8px; margin:0; padding-left:18px; color:#b9c2d0; }
.empty { margin:0; padding:28px; border:1px dashed #303949; border-radius:12px; color:var(--muted); text-align:center; }
footer { display:flex; justify-content:space-between; padding:26px 4px 0; color:#536074; font-size:11px; letter-spacing:.05em; text-transform:uppercase; }
@media (max-width:760px) { .shell{width:min(100% - 24px,1180px);padding-top:32px}.hero{align-items:flex-start;flex-direction:column}.metrics{grid-template-columns:repeat(2,1fr)}.contract-grid,.impact-list,.intent-trace{grid-template-columns:1fr}.intent-trace-groups{border-left:0;border-top:2px solid var(--line);padding:20px 0 0}.intent-trace-group::before{display:none}.severity-bar{flex-wrap:wrap}.panel{padding:18px}.intent{grid-template-columns:1fr}.report-state{width:100%} }
`;
