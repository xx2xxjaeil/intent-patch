import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { EnvironmentGitHubActionRuntime } from "../../src/presentation/github/action-runtime.js";

describe("EnvironmentGitHubActionRuntime", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  it("reads action inputs and writes environment file outputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "intentpatch-action-runtime-"));
    temporaryDirectories.push(directory);
    const outputFile = join(directory, "output");
    const summaryFile = join(directory, "summary");
    await Promise.all([writeFile(outputFile, ""), writeFile(summaryFile, "")]);
    const runtime = new EnvironmentGitHubActionRuntime({
      "INPUT_FAIL-ON": " medium ",
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    });

    assert.equal(runtime.getInput("fail-on"), "medium");
    await runtime.setOutput("json-report", "/tmp/report.json");
    await runtime.addSummary("## Report\n");

    const output = await readFile(outputFile, "utf8");
    assert.match(output, /^json-report<<intentpatch_[\w-]+\n\/tmp\/report\.json\n/);
    assert.equal(await readFile(summaryFile, "utf8"), "## Report\n");
  });

  it("rejects unsafe output names", async () => {
    const runtime = new EnvironmentGitHubActionRuntime({});
    await assert.rejects(() => runtime.setOutput("invalid output", "value"), /Invalid/);
  });

  it("annotates current code lines and leaves previous-only locations at file level", () => {
    const runtime = new EnvironmentGitHubActionRuntime({});
    const messages: string[] = [];
    const original = console.log;
    console.log = (message: string) => messages.push(message);
    try {
      const finding = {
        ruleId: "api/change",
        severity: "high" as const,
        title: "Changed API",
        description: "Review this API.",
        file: "src/api.ts",
        evidence: {},
      };
      runtime.annotate({ ...finding, location: { side: "current", line: 8 } });
      runtime.annotate({ ...finding, location: { side: "previous", line: 3 } });
    } finally {
      console.log = original;
    }
    assert.match(messages[0] ?? "", /file=src\/api\.ts,line=8,title=/u);
    assert.match(messages[1] ?? "", /file=src\/api\.ts,title=/u);
    assert.doesNotMatch(messages[1] ?? "", /,line=/u);
  });
});
