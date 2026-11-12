import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { createChangeSet } from "../../src/domain/change.js";
import { createChangeContract } from "../../src/domain/change-contract.js";
import { createCodeStructureAnalysis } from "../../src/domain/code-structure.js";
import { createFindingSet } from "../../src/domain/finding.js";
import { createImpactAnalysis } from "../../src/domain/impact.js";
import type { ChangeReport } from "../../src/domain/report.js";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";
import { createTestChangeAnalysis } from "../../src/domain/test-change.js";
import { formatHtmlReport } from "../../src/presentation/html/html-report.js";

describe("formatHtmlReport", () => {
  it("links a located finding to its Git hunk line and falls back when the line is absent", () => {
    const base = createReport();
    const finding = {
      ruleId: "api/public-signature-changed",
      severity: "high" as const,
      title: "Changed API",
      description: "Review the function declaration.",
      file: "src/user.ts",
      evidence: { symbolName: "deleteUser" },
    };
    const output = formatHtmlReport({
      ...base,
      findings: createFindingSet([
        { ...finding, location: { side: "current", line: 5 } },
        { ...finding, location: { side: "previous", line: 4 } },
        { ...finding, location: { side: "current", line: 30 } },
      ]),
      patchPreviews: [
        {
          path: "src/user.ts",
          lines: ["@@ -4 +5 @@", "-old", "+new"],
          truncated: false,
        },
      ],
    });
    assert.match(output, /src\/user\.ts:5/u);
    assert.match(output, /src\/user\.ts:4 \(previous revision\)/u);
    assert.match(output, /href="#diff-0-C5">Review code line/u);
    assert.match(output, /href="#diff-0-P4">Review code line/u);
    assert.match(output, /href="#diff-0">Review file diff/u);
    assert.match(output, /id="diff-0-C5">\+new/u);
  });
  it("links findings to escaped, bounded diff context", () => {
    const output = formatHtmlReport({
      ...createReport(),
      patchPreviews: [
        {
          path: "src/user.ts",
          lines: ["@@ -1 +1 @@", "-old", "+<script>alert(1)</script>"],
          truncated: true,
        },
      ],
    });
    assert.match(output, /href="#diff-0">Review file diff/);
    assert.match(output, /id="diff-0"/);
    assert.match(output, /class="patch-add"[^>]*>\+&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(output, /Preview truncated/);
    assert.doesNotMatch(output, /\+<script>alert/);
  });

  it("renders a self-contained report with analysis evidence", () => {
    const output = formatHtmlReport(createReport());
    assert.match(output, /Analysis coverage/u);
    assert.match(output, /2 outside target/u);

    assert.match(output, /^<!doctype html>/);
    assert.doesNotMatch(output, /[ \t]+$/gmu);
    assert.match(output, /Agent Change Report/);
    assert.match(output, /HEAD → working tree/);
    assert.match(output, /Files changed/);
    assert.match(output, /Risky API changes/);
    assert.match(output, /Structure signals/);
    assert.match(output, /Potential issues/);
    assert.match(output, /Exported symbol removed/);
    assert.match(output, /Source change without matching test change/);
    assert.match(output, /src\/user\.ts/);
    assert.match(output, /tests\/user\.test\.ts/);
    assert.match(output, /Changed symbols/);
    assert.match(output, /deleteUser/);
    assert.match(output, /<svg[^>]+aria-label="Dependency impact graph"/);
    assert.match(output, /graph-edge direct/);
    assert.match(output, /graph-edge transitive/);
    assert.match(output, /data-graph-action="in"/);
    assert.match(output, /data-graph-from="src\/user\.ts"/);
    assert.match(output, /id="path-filter"/);
    assert.match(output, /data-severity-filter="high"/);
    assert.match(output, /data-report-path="src\/user\.ts"/);
    assert.match(output, /href="#file-0"/);
    assert.match(output, /Request → changed files/);
    assert.match(output, /class="intent-trace-group expected"/);
    assert.match(output, /class="intent-trace-group outside"/);
    assert.match(output, /href="#file-1">tests\/user\.test\.ts<\/a>/);
    assert.match(output, /href="#impact-0"/);
    assert.doesNotMatch(output, /https?:\/\//);
  });

  it("escapes values originating from analyzed repositories", () => {
    const output = formatHtmlReport(createReport());

    assert.match(output, /Delete &lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
    assert.match(output, /Review &lt;unsafe&gt;/);
    assert.doesNotMatch(output, /<script>alert/);
    assert.match(output, /<strong>Delete &lt;script&gt;/);
  });

  it("shows accepted and expired baseline entries without rendering their text as HTML", () => {
    const report = createReport();
    const finding = report.findings.items[0];
    assert.ok(finding);
    const output = formatHtmlReport({
      ...report,
      baseline: {
        suppressed: [{ finding, reason: "Reviewed <script>risk</script>", expires: "2026-12-31" }],
        expired: [
          {
            ruleId: "api/public-signature-changed",
            file: "src/<bad>.ts",
            evidence: { symbolName: "deleteUser" },
            reason: "Past <review>",
            expires: "2026-01-01",
          },
        ],
      },
    });
    assert.match(output, /1 suppressed · 1 expired/);
    assert.match(output, /Reviewed &lt;script&gt;risk&lt;\/script&gt;/);
    assert.match(output, /Expired: api\/public-signature-changed/);
    assert.match(output, /Past &lt;review&gt;/);
    assert.doesNotMatch(output, /<script>risk<\/script>/);
  });

  it("marks impact found through previous imports after a module deletion", () => {
    const report = createReport();
    const output = formatHtmlReport({
      ...report,
      impact: createImpactAnalysis({
        sourceFiles: 1,
        changedModules: ["src/deleted.ts"],
        dependencies: [],
        impactedFiles: [
          {
            path: "src/importer.ts",
            distance: 1,
            changedModules: ["src/deleted.ts"],
            viaPreviousImports: true,
          },
        ],
      }),
    });

    assert.match(output, /graph-edge direct previous/);
    assert.match(output, /previous imports/);
  });

  it("filters report rows by path and severity without a network resource", () => {
    const html = formatHtmlReport(createReport());
    const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];
    assert.ok(script);

    const element = (attributes: Record<string, string> = {}) => {
      const listeners = new Map<
        string,
        (event?: { key?: string; preventDefault?: () => void }) => void
      >();
      return {
        hidden: false,
        value: "",
        textContent: "",
        getAttribute: (key: string) => attributes[key] ?? null,
        setAttribute: (key: string, value: string) => {
          attributes[key] = value;
        },
        addEventListener: (
          event: string,
          callback: (payload?: { key?: string; preventDefault?: () => void }) => void,
        ) => {
          listeners.set(event, callback);
        },
        fire: (event: string, payload?: { key?: string; preventDefault?: () => void }) => {
          listeners.get(event)?.(payload);
        },
      };
    };
    const controls = element();
    controls.hidden = true;
    const input = element();
    const status = element();
    const graphStatus = element();
    const graph = element({ "data-graph-height": "200", viewBox: "0 0 1000 200" });
    const graphUser = element({ "data-graph-path": "src/user.ts" });
    const graphAccount = element({ "data-graph-path": "src/account.ts" });
    const graphEdge = element({
      "data-graph-from": "src/user.ts",
      "data-graph-to": "src/account.ts",
    });
    const zoomIn = element({ "data-graph-action": "in" });
    const high = element({ "data-report-path": "src/user.ts", "data-finding-severity": "high" });
    const medium = element({
      "data-report-path": "src/account.ts",
      "data-finding-severity": "medium",
    });
    const file = element({ "data-report-path": "src/user.ts" });
    const intentRow = element({ "data-report-path": "src/user.ts" });
    const intentCount = element();
    const intentGroup = {
      hidden: false,
      querySelectorAll: () => [intentRow],
      querySelector: () => intentCount,
    };
    const buttons = ["all", "high", "medium", "low"].map((severity) =>
      element({ "data-severity-filter": severity }),
    );
    const link = element();
    const document = {
      getElementById: (id: string) =>
        ({
          "report-controls": controls,
          "path-filter": input,
          "visible-count": status,
          "graph-visible-count": graphStatus,
        })[id as "report-controls" | "path-filter" | "visible-count" | "graph-visible-count"],
      querySelector: (selector: string) => (selector === ".impact-graph" ? graph : null),
      querySelectorAll: (selector: string) =>
        selector === "[data-report-path]"
          ? [high, medium, file, intentRow]
          : selector === "[data-intent-group]"
            ? [intentGroup]
            : selector === "[data-severity-filter]"
              ? buttons
              : selector === "[data-graph-path]"
                ? [graphUser, graphAccount]
                : selector === "[data-graph-from]"
                  ? [graphEdge]
                  : selector === "[data-graph-action]"
                    ? [zoomIn]
                    : selector === ".impact-graph a[href^='#']"
                      ? [link]
                      : [],
    };
    runInNewContext(script, { document });
    assert.equal(controls.hidden, false);
    assert.equal(status.textContent, "2 findings shown");
    assert.equal(intentCount.textContent, "1");
    assert.equal(graphStatus.textContent, "2 graph files shown");
    zoomIn.fire("click");
    assert.equal(graph.getAttribute("viewBox"), "125 25 750 150");
    graph.fire("keydown", { key: "ArrowRight", preventDefault: () => {} });
    assert.equal(graph.getAttribute("viewBox"), "218.75 25 750 150");

    input.value = "user";
    input.fire("input");
    assert.equal(intentGroup.hidden, false);
    assert.equal(high.hidden, false);
    assert.equal(medium.hidden, true);
    assert.equal(file.hidden, false);
    input.value = "account";
    input.fire("input");
    assert.equal(intentGroup.hidden, true);
    assert.equal(intentCount.textContent, "0");
    input.value = "user";
    input.fire("input");
    assert.equal(graphUser.hidden, false);
    assert.equal(graphAccount.hidden, true);
    assert.equal(graphEdge.hidden, true);
    buttons[2]?.fire("click");
    assert.equal(high.hidden, true);
    link.fire("click");
    assert.equal(input.value, "");
    assert.equal(medium.hidden, false);
    assert.equal(status.textContent, "1 findings shown");
  });
});

function createReport(): ChangeReport {
  return {
    target: { baseRef: "HEAD" },
    contract: createChangeContract({
      intent: "Delete <script>alert('x')</script>",
      scope: { include: ["src/**"], maxFiles: 4 },
      tests: { requireFor: ["src/**"], include: ["tests/**"] },
    }),
    changes: createChangeSet([
      {
        path: "src/user.ts",
        kind: "modified",
        lines: { kind: "measured", additions: 8, deletions: 2 },
      },
      {
        path: "tests/user.test.ts",
        kind: "added",
        lines: { kind: "measured", additions: 12, deletions: 0 },
      },
    ]),
    analysisCoverage: {
      changedFiles: 2,
      symbolFilesChecked: 0,
      symbolFilesUnavailable: 0,
      symbolFilesNotTargeted: 2,
      importGraphSourceFilesRead: 2,
      unresolvedImports: 0,
      importGraphIssues: 0,
      binaryFiles: 0,
      unmeasuredLineFiles: 0,
    },
    findings: createFindingSet([
      {
        ruleId: "tests/missing-related-change",
        severity: "medium",
        title: "Source change without matching test change",
        description: "Review <unsafe>",
        file: "src/user.ts",
        evidence: { matchingStrategy: "basename" },
      },
      {
        ruleId: "api/exported-symbol-removed",
        severity: "high",
        title: "Exported symbol removed",
        description: "The exported function deleteUser was removed.",
        file: "src/user.ts",
        evidence: { symbolName: "deleteUser", symbolKind: "function" },
      },
    ]),
    symbolChanges: createSymbolChangeSet([
      {
        path: "src/user.ts",
        name: "deleteUser",
        symbolKind: "function",
        changeKind: "modified",
        afterLine: 12,
      },
    ]),
    codeStructure: createCodeStructureAnalysis({
      sourceFiles: 2,
      duplicateCandidates: [],
      singleImplementationAbstractions: [],
    }),
    impact: createImpactAnalysis({
      sourceFiles: 2,
      changedModules: ["src/user.ts"],
      dependencies: [{ importer: "src/api.ts", imported: "src/user.ts" }],
      impactedFiles: [
        { path: "src/api.ts", distance: 1, changedModules: ["src/user.ts"] },
        { path: "src/app.ts", distance: 2, changedModules: ["src/user.ts"] },
      ],
    }),
    testChanges: createTestChangeAnalysis({
      testFiles: [{ path: "tests/user.test.ts", changeKind: "added" }],
      sourceCoverage: [
        {
          sourcePath: "src/user.ts",
          sourceChangeKind: "modified",
          matchingTests: ["tests/user.test.ts"],
        },
      ],
    }),
  };
}
