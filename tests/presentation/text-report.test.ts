import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createChangeSet } from "../../src/domain/change.js";
import { createFindingSet } from "../../src/domain/finding.js";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";
import { formatTextReport } from "../../src/presentation/cli/text-report.js";

describe("formatTextReport", () => {
  it("shows dependency counts and evidence-based findings", () => {
    const output = formatTextReport({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([
        {
          path: "package.json",
          kind: "modified",
          lines: { kind: "measured", additions: 1, deletions: 0 },
        },
      ]),
      findings: createFindingSet([
        {
          ruleId: "dependency/new-production",
          severity: "medium",
          title: "New production dependency",
          description: "dayjs@1.0.0 was added to dependencies.",
          file: "package.json",
          evidence: { package: "dayjs", version: "1.0.0" },
        },
      ]),
      symbolChanges: createSymbolChangeSet([
        {
          path: "src/user.ts",
          name: "deleteUser",
          symbolKind: "function",
          changeKind: "added",
          afterLine: 12,
        },
      ]),
    });

    assert.match(output, /New dependencies {5}1/);
    assert.match(output, /Findings {13}1/);
    assert.match(output, /Changed symbols {6}1/);
    assert.match(output, /A {2}Function {6}deleteUser/);
    assert.match(output, /src\/user\.ts:12/);
    assert.match(output, /MEDIUM {2}New production dependency/);
    assert.match(output, /package\.json · dependency\/new-production/);
  });
});
