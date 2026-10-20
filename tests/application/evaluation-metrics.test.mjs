import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareEvaluationLabels,
  summarizeEvaluation,
  summarizeEvaluationByRule,
} from "../../scripts/evaluation-metrics.mjs";

describe("external evaluation metrics", () => {
  it("matches findings by file and public name, independent of order", () => {
    const expected = [
      { file: "async/index.js", symbolName: "nanoid" },
      { file: "async/index.js", symbolName: "random" },
    ];
    const actual = [
      { file: "async/index.js", symbolName: "random" },
      { file: "index.js", symbolName: "nanoid" },
    ];
    const result = compareEvaluationLabels(expected, actual);

    assert.deepEqual(result.matched, [expected[1]]);
    assert.deepEqual(result.missing, [expected[0]]);
    assert.deepEqual(result.unexpected, [actual[1]]);
    assert.deepEqual(summarizeEvaluation([result, result]), {
      matched: 2,
      missing: 2,
      unexpected: 2,
    });
  });

  it("rejects duplicate labels instead of silently inflating the score", () => {
    const label = { file: "api.ts", symbolName: "oldExport" };
    assert.throws(() => compareEvaluationLabels([label, label], []), /Duplicate expected label/);
    assert.throws(() => compareEvaluationLabels([], [label, label]), /Duplicate actual label/);
  });

  it("summarizes checks independently for each rule", () => {
    const matching = {
      matched: [{ file: "api.ts", symbolName: "run" }],
      missing: [],
      unexpected: [],
    };
    const missing = {
      matched: [],
      missing: [{ file: "api.ts", symbolName: "Options" }],
      unexpected: [],
    };
    assert.deepEqual(
      summarizeEvaluationByRule([
        { ruleId: "api/public-signature-changed", ...matching },
        { ruleId: "api/public-type-member-removed", ...missing },
        { ruleId: "api/public-signature-changed", ...matching },
      ]),
      {
        "api/public-signature-changed": { cases: 2, matched: 2, missing: 0, unexpected: 0 },
        "api/public-type-member-removed": { cases: 1, matched: 0, missing: 1, unexpected: 0 },
      },
    );
  });
});
