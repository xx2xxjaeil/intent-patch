import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CliUsageError, parseArguments } from "../../src/presentation/cli/arguments.js";

describe("parseArguments", () => {
  it("parses the version flag as a top-level command", () => {
    assert.deepEqual(parseArguments(["--version"], "/repo"), { command: "version" });
    assert.deepEqual(parseArguments(["-v"], "/repo"), { command: "version" });
  });

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
        [
          "analyze",
          "--base",
          "main",
          "--head",
          "feature",
          "--cwd",
          "/code",
          "--config",
          "contracts/delete-user.json",
          "--json",
          "--fail-on",
          "medium",
        ],
        "/repo",
      ),
      {
        command: "analyze",
        baseRef: "main",
        headRef: "feature",
        workingDirectory: "/code",
        configurationPath: "contracts/delete-user.json",
        outputFormat: "json",
        failOn: "medium",
      },
    );
  });

  it("parses HTML output to a file", () => {
    assert.deepEqual(
      parseArguments(["analyze", "--format", "html", "--output", "report.html"], "/repo"),
      {
        command: "analyze",
        workingDirectory: "/repo",
        outputFormat: "html",
        outputPath: "report.html",
      },
    );
  });

  it("rejects an option without a value", () => {
    assert.throws(() => parseArguments(["analyze", "--base"], "/repo"), CliUsageError);
  });

  it("rejects an unknown failure severity", () => {
    assert.throws(
      () => parseArguments(["analyze", "--fail-on", "critical"], "/repo"),
      /Invalid severity/,
    );
  });

  it("rejects unknown and conflicting output formats", () => {
    assert.throws(
      () => parseArguments(["analyze", "--format", "xml"], "/repo"),
      /Invalid output format/,
    );
    assert.throws(
      () => parseArguments(["analyze", "--json", "--format", "html"], "/repo"),
      /Output format already set/,
    );
  });
});
