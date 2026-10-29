import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateEvaluationManifest } from "../../scripts/evaluation-manifest.mjs";

const validCase = {
  id: "type-member-removal",
  ruleId: "api/public-type-member-removed",
  repository: "p-queue",
  head: "a".repeat(40),
  reason: "Reviewed against the source diff.",
  expected: [{ file: "source/options.ts", symbolName: "Options" }],
};

function manifest(cases = [validCase]) {
  return {
    schemaVersion: 2,
    repositories: { "p-queue": "https://github.com/sindresorhus/p-queue.git" },
    cases,
  };
}

describe("external evaluation manifest", () => {
  it("accepts independently scored rule cases", () => {
    assert.doesNotThrow(() =>
      validateEvaluationManifest(
        manifest([
          validCase,
          { ...validCase, id: "export-removal", ruleId: "api/exported-symbol-removed" },
        ]),
      ),
    );
  });

  it("rejects unknown rules and duplicate case IDs", () => {
    assert.throws(
      () => validateEvaluationManifest(manifest([{ ...validCase, ruleId: "api/typo" }])),
      /Invalid external evaluation case/,
    );
    assert.throws(
      () => validateEvaluationManifest(manifest([validCase, validCase])),
      /Invalid external evaluation case/,
    );
  });

  it("rejects duplicate or malformed labels", () => {
    assert.throws(
      () =>
        validateEvaluationManifest(
          manifest([{ ...validCase, expected: [validCase.expected[0], validCase.expected[0]] }]),
        ),
      /Duplicate expected label/,
    );
    assert.throws(
      () => validateEvaluationManifest(manifest([{ ...validCase, expected: [{ file: "" }] }])),
      /Evaluation labels require/,
    );
  });

  it("requires reviewed package labels and explicit contracts for non-API cases", () => {
    const dependency = {
      ...validCase,
      id: "new-package",
      ruleId: "dependency/new-production",
      expected: [{ file: "package.json", package: "queue" }],
    };
    assert.doesNotThrow(() => validateEvaluationManifest(manifest([dependency])));
    assert.throws(
      () =>
        validateEvaluationManifest(
          manifest([{ ...dependency, expected: [{ file: "package.json", symbolName: "queue" }] }]),
        ),
      /Invalid package label/,
    );
    assert.throws(
      () =>
        validateEvaluationManifest(
          manifest([
            {
              ...validCase,
              ruleId: "scope/outside-expected-path",
              expected: [{ file: "src/x.ts" }],
            },
          ]),
        ),
      /Missing contract/,
    );
  });
});
