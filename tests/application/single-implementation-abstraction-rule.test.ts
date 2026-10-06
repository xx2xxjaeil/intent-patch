import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SingleImplementationAbstractionRule } from "../../src/application/rules/single-implementation-abstraction-rule.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createCodeStructureAnalysis } from "../../src/domain/code-structure.js";

describe("SingleImplementationAbstractionRule", () => {
  it("does nothing when structure analysis is unavailable", async () => {
    const findings = await new SingleImplementationAbstractionRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
    });

    assert.deepEqual(findings, []);
  });

  it("reports a new interface with exactly one implementation", async () => {
    const findings = await new SingleImplementationAbstractionRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
      codeStructure: createCodeStructureAnalysis({
        sourceFiles: 1,
        duplicateCandidates: [],
        singleImplementationAbstractions: [
          {
            abstraction: { path: "src/delete-user.ts", name: "DeletionStrategy", line: 3 },
            implementation: {
              path: "src/delete-user.ts",
              name: "DefaultDeletionStrategy",
              line: 8,
            },
          },
        ],
      }),
    });

    assert.deepEqual(findings, [
      {
        ruleId: "structure/single-implementation-abstraction",
        severity: "low",
        title: "New interface has one implementation",
        description:
          "The new interface DeletionStrategy is implemented only by DefaultDeletionStrategy.",
        file: "src/delete-user.ts",
        evidence: {
          interfaceName: "DeletionStrategy",
          interfaceLine: 3,
          implementationName: "DefaultDeletionStrategy",
          implementationFile: "src/delete-user.ts",
          implementationLine: 8,
        },
      },
    ]);
  });
});
