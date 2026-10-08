import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ActionInputSource,
  readGitHubActionInputs,
} from "../../src/presentation/github/action-inputs.js";

describe("readGitHubActionInputs", () => {
  it("uses safe defaults when optional inputs are absent", () => {
    assert.deepEqual(readGitHubActionInputs(inputSource({})), {
      workingDirectory: ".",
      reportDirectory: "intentpatch-report",
      failOn: "high",
    });
  });

  it("parses explicit paths, comparison refs, and the quality gate", () => {
    assert.deepEqual(
      readGitHubActionInputs(
        inputSource({
          "working-directory": "packages/api",
          "report-directory": "artifacts/intentpatch",
          config: "contracts/pr.json",
          base: "main",
          head: "feature/delete-user",
          "fail-on": "medium",
        }),
      ),
      {
        workingDirectory: "packages/api",
        reportDirectory: "artifacts/intentpatch",
        configurationPath: "contracts/pr.json",
        baseRef: "main",
        headRef: "feature/delete-user",
        failOn: "medium",
      },
    );
  });

  it("rejects incomplete comparisons and invalid severities", () => {
    assert.throws(
      () => readGitHubActionInputs(inputSource({ base: "main" })),
      /must be provided together/,
    );
    assert.throws(
      () => readGitHubActionInputs(inputSource({ "fail-on": "critical" })),
      /Invalid GitHub Action fail-on severity/,
    );
  });
});

function inputSource(values: Readonly<Record<string, string>>): ActionInputSource {
  return { getInput: (name) => values[name] };
}
