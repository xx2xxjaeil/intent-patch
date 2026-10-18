import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PublicApiRemovalRule } from "../../src/application/rules/public-api-removal-rule.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";

describe("PublicApiRemovalRule", () => {
  it("does nothing when symbol analysis is unavailable", async () => {
    const findings = await new PublicApiRemovalRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
    });

    assert.deepEqual(findings, []);
  });

  it("reports exported deletions and export removal without flagging internal changes", async () => {
    const findings = await new PublicApiRemovalRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
      symbolChanges: createSymbolChangeSet([
        {
          path: "src/account.ts",
          name: "AccountService",
          symbolKind: "class",
          changeKind: "modified",
          beforeLine: 4,
          afterLine: 4,
          beforeExported: true,
          afterExported: false,
        },
        {
          path: "src/internal.ts",
          name: "helper",
          symbolKind: "function",
          changeKind: "deleted",
          beforeLine: 2,
          beforeExported: false,
        },
        {
          path: "src/user.ts",
          name: "deleteUser",
          symbolKind: "function",
          changeKind: "deleted",
          beforeLine: 12,
          beforeExported: true,
        },
        {
          path: "src/user.ts",
          name: "getUser",
          symbolKind: "function",
          changeKind: "modified",
          beforeLine: 20,
          afterLine: 21,
          beforeExported: true,
          afterExported: true,
        },
      ]),
    });

    assert.deepEqual(findings, [
      {
        ruleId: "api/export-removed",
        severity: "high",
        title: "Public export removed",
        description: "The class AccountService is no longer exported.",
        file: "src/account.ts",
        evidence: {
          symbolName: "AccountService",
          symbolKind: "class",
          previousLine: 4,
          currentLine: 4,
        },
      },
      {
        ruleId: "api/exported-symbol-removed",
        severity: "high",
        title: "Exported symbol removed",
        description: "The exported function deleteUser was removed.",
        file: "src/user.ts",
        evidence: {
          symbolName: "deleteUser",
          symbolKind: "function",
          previousLine: 12,
        },
      },
    ]);
  });

  it("does not call a retained export a removal when its declaration kind changes", async () => {
    const findings = await new PublicApiRemovalRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
      symbolChanges: createSymbolChangeSet([
        {
          path: "src/api.ts",
          name: "TimeoutError",
          symbolKind: "re-export",
          changeKind: "deleted",
          beforeExported: true,
        },
        {
          path: "src/api.ts",
          name: "TimeoutError",
          symbolKind: "class",
          changeKind: "added",
          afterExported: true,
        },
        {
          path: "src/legacy.ts",
          name: "TimeoutError",
          symbolKind: "class",
          changeKind: "deleted",
          beforeExported: true,
        },
      ]),
    });

    assert.deepEqual(
      findings.map((finding) => [finding.file, finding.evidence.symbolName]),
      [["src/legacy.ts", "TimeoutError"]],
    );
  });
});
