import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCodeStructureAnalysis } from "../../src/domain/code-structure.js";

describe("createCodeStructureAnalysis", () => {
  it("sorts, summarizes, and freezes structure evidence", () => {
    const analysis = createCodeStructureAnalysis({
      sourceFiles: 4,
      duplicateCandidates: [
        {
          added: { path: "src/z.ts", name: "newZ", line: 8 },
          existing: { path: "src/base.ts", name: "baseZ", line: 2 },
        },
        {
          added: { path: "src/a.ts", name: "newA", line: 3 },
          existing: { path: "src/base.ts", name: "baseA", line: 1 },
        },
      ],
      singleImplementationAbstractions: [
        {
          abstraction: { path: "src/strategy.ts", name: "Strategy", line: 1 },
          implementation: { path: "src/strategy.ts", name: "DefaultStrategy", line: 5 },
        },
      ],
      issues: [{ path: "src/broken.ts", reason: "parse failed" }],
    });

    assert.deepEqual(
      analysis.duplicateCandidates.map((candidate) => candidate.added.name),
      ["newA", "newZ"],
    );
    assert.deepEqual(analysis.summary, {
      sourceFiles: 4,
      filesUnavailable: 1,
      duplicateCandidates: 2,
      singleImplementationAbstractions: 1,
    });
    assert.equal(Object.isFrozen(analysis), true);
    assert.equal(Object.isFrozen(analysis.duplicateCandidates[0]?.added), true);
  });

  it("rejects duplicate evidence identities and invalid file counts", () => {
    const duplicate = {
      added: { path: "src/a.ts", name: "newA", line: 3 },
      existing: { path: "src/base.ts", name: "baseA", line: 1 },
    };

    assert.throws(
      () =>
        createCodeStructureAnalysis({
          sourceFiles: 1,
          duplicateCandidates: [duplicate, duplicate],
          singleImplementationAbstractions: [],
        }),
      /Duplicate duplicate implementation candidate/,
    );
    assert.throws(
      () =>
        createCodeStructureAnalysis({
          sourceFiles: -1,
          duplicateCandidates: [],
          singleImplementationAbstractions: [],
        }),
      /non-negative integer/,
    );
  });
});
