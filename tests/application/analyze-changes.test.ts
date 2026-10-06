import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChangeSource } from "../../src/application/ports/change-source.js";
import { RuleEngine } from "../../src/application/services/rule-engine.js";
import { AnalyzeChanges } from "../../src/application/use-cases/analyze-changes.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createChangeContract } from "../../src/domain/change-contract.js";

describe("AnalyzeChanges", () => {
  it("uses HEAD and the working tree by default", async () => {
    const changes = createChangeSet([]);
    let receivedTarget: Parameters<ChangeSource["collect"]>[0] | undefined;
    const useCase = new AnalyzeChanges({
      collect: async (target) => {
        receivedTarget = target;
        return changes;
      },
    });

    const report = await useCase.execute();

    assert.deepEqual(receivedTarget, { baseRef: "HEAD" });
    assert.deepEqual(report, {
      target: { baseRef: "HEAD" },
      changes,
      findings: {
        items: [],
        summary: { total: 0, bySeverity: { high: 0, medium: 0, low: 0 } },
      },
      symbolChanges: {
        changes: [],
        issues: [],
        summary: {
          total: 0,
          filesAnalyzed: 0,
          filesUnavailable: 0,
          byChangeKind: { added: 0, modified: 0, deleted: 0 },
        },
      },
      codeStructure: {
        duplicateCandidates: [],
        singleImplementationAbstractions: [],
        issues: [],
        summary: {
          sourceFiles: 0,
          filesUnavailable: 0,
          duplicateCandidates: 0,
          singleImplementationAbstractions: 0,
        },
      },
      impact: {
        changedModules: [],
        dependencies: [],
        impactedFiles: [],
        unresolvedReferences: [],
        issues: [],
        summary: {
          sourceFiles: 0,
          changedModules: 0,
          dependencies: 0,
          directDependents: 0,
          transitiveDependents: 0,
          unresolvedReferences: 0,
          filesUnavailable: 0,
        },
      },
      testChanges: {
        testFiles: [],
        sourceCoverage: [],
        summary: {
          testsChanged: 0,
          testsAdded: 0,
          testsDeleted: 0,
          sourceFilesChecked: 0,
          sourceFilesWithoutTestChanges: 0,
        },
      },
    });
  });

  it("normalizes an explicit comparison range", async () => {
    const changes = createChangeSet([]);
    let receivedTarget: Parameters<ChangeSource["collect"]>[0] | undefined;
    const useCase = new AnalyzeChanges({
      collect: async (target) => {
        receivedTarget = target;
        return changes;
      },
    });

    await useCase.execute({ baseRef: " main ", headRef: " feature/account " });

    assert.deepEqual(receivedTarget, {
      baseRef: "main",
      headRef: "feature/account",
    });
  });

  it("passes a change contract to rules and preserves it in the report", async () => {
    const changes = createChangeSet([]);
    const contract = createChangeContract({
      intent: "회원 탈퇴 구현",
      scope: { include: ["src/user/**"] },
    });
    let receivedContract: unknown;
    let receivedTestChanges: unknown;
    let receivedSymbolChanges: unknown;
    let receivedCodeStructure: unknown;
    const useCase = new AnalyzeChanges(
      { collect: async () => changes },
      new RuleEngine([
        {
          analyze: async (context) => {
            receivedContract = context.contract;
            receivedTestChanges = context.testChanges;
            receivedSymbolChanges = context.symbolChanges;
            receivedCodeStructure = context.codeStructure;
            return [];
          },
        },
      ]),
    );

    const report = await useCase.execute({ contract });

    assert.equal(receivedContract, contract);
    assert.equal(receivedTestChanges, report.testChanges);
    assert.equal(receivedSymbolChanges, report.symbolChanges);
    assert.equal(receivedCodeStructure, report.codeStructure);
    assert.equal(report.contract, contract);
  });

  it("rejects references that Git could interpret as options", async () => {
    const useCase = new AnalyzeChanges({
      collect: async () => createChangeSet([]),
    });

    await assert.rejects(() => useCase.execute({ baseRef: "--stat" }), /must not start/);
  });
});
