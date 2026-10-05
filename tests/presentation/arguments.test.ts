import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CliUsageError, parseArguments } from "../../src/presentation/cli/arguments.js";

describe("parseArguments", () => {
  it("parses an analyze command without optional values", () => {
    assert.deepEqual(parseArguments(["analyze"], "/repo"), {
      command: "analyze",
      workingDirectory: "/repo",
      outputFormat: "text",
    });
  });

  it("parses an explicit range and JSON output", () => {
    assert.deepEqual(
      parseArguments(
        ["analyze", "--base", "main", "--head", "feature", "--cwd", "/code", "--json"],
        "/repo",
      ),
      {
        command: "analyze",
        baseRef: "main",
        headRef: "feature",
        workingDirectory: "/code",
        outputFormat: "json",
      },
    );
  });

  it("rejects an option without a value", () => {
    assert.throws(() => parseArguments(["analyze", "--base"], "/repo"), CliUsageError);
  });
});
