import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DuplicateImplementationRule } from "../../src/application/rules/duplicate-implementation-rule.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createCodeStructureAnalysis } from "../../src/domain/code-structure.js";

describe("DuplicateImplementationRule", () => {
  it("does nothing when structure analysis is unavailable", async () => {
    const findings = await new DuplicateImplementationRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
    });

    assert.deepEqual(findings, []);
  });

  it("reports an evidence-backed reuse candidate", async () => {
    const findings = await new DuplicateImplementationRule().analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([]),
      codeStructure: createCodeStructureAnalysis({
        sourceFiles: 2,
        duplicateCandidates: [
          {
            added: { path: "src/delete-user.ts", name: "verifySession", line: 9 },
            existing: { path: "src/auth.ts", name: "authorize", line: 4 },
          },
        ],
        singleImplementationAbstractions: [],
      }),
    });

    assert.deepEqual(findings, [
      {
        ruleId: "structure/duplicate-implementation",
        severity: "medium",
        title: "New function duplicates existing implementation",
        description:
          "The new function verifySession has the same normalized implementation as authorize.",
        file: "src/delete-user.ts",
        evidence: {
          addedFunction: "verifySession",
          addedLine: 9,
          existingFunction: "authorize",
          existingFile: "src/auth.ts",
          existingLine: 4,
        },
      },
    ]);
  });
});
