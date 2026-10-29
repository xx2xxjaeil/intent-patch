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
  it("renders a self-contained report with analysis evidence", () => {
    const output = formatHtmlReport(createReport());

    assert.match(output, /^<!doctype html>/);
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
    assert.match(output, /id="path-filter"/);
    assert.match(output, /data-severity-filter="high"/);
    assert.match(output, /data-report-path="src\/user\.ts"/);
    assert.match(output, /href="#file-0"/);
    assert.match(output, /href="#impact-0"/);
    assert.doesNotMatch(output, /https?:\/\//);
  });

  it("escapes values originating from analyzed repositories", () => {
    const output = formatHtmlReport(createReport());

    assert.match(output, /Delete &lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
    assert.match(output, /Review &lt;unsafe&gt;/);
    assert.doesNotMatch(output, /<script>alert/);
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
      const listeners = new Map<string, () => void>();
      return {
        hidden: false,
        value: "",
        textContent: "",
        getAttribute: (key: string) => attributes[key] ?? null,
        setAttribute: (key: string, value: string) => {
          attributes[key] = value;
        },
        addEventListener: (event: string, callback: () => void) => {
          listeners.set(event, callback);
        },
        fire: (event: string) => {
          listeners.get(event)?.();
        },
      };
    };
    const controls = element();
    controls.hidden = true;
    const input = element();
    const status = element();
    const high = element({ "data-report-path": "src/user.ts", "data-finding-severity": "high" });
    const medium = element({
      "data-report-path": "src/account.ts",
      "data-finding-severity": "medium",
    });
    const file = element({ "data-report-path": "src/user.ts" });
    const buttons = ["all", "high", "medium", "low"].map((severity) =>
      element({ "data-severity-filter": severity }),
    );
    const link = element();
    const document = {
      getElementById: (id: string) =>
        ({ "report-controls": controls, "path-filter": input, "visible-count": status })[
          id as "report-controls" | "path-filter" | "visible-count"
        ],
      querySelectorAll: (selector: string) =>
        selector === "[data-report-path]"
          ? [high, medium, file]
          : selector === "[data-severity-filter]"
            ? buttons
            : [link],
    };
    runInNewContext(script, { document });
    assert.equal(controls.hidden, false);
    assert.equal(status.textContent, "2 findings shown");

    input.value = "user";
    input.fire("input");
    assert.equal(high.hidden, false);
    assert.equal(medium.hidden, true);
    assert.equal(file.hidden, false);
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
