import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CliUsageError, parseArguments } from "../../src/presentation/cli/arguments.js";

describe("parseArguments", () => {
  it("parses a safe init template and explicit scope/test options", () => {
    assert.deepEqual(parseArguments(["init"], "/repo"), {
      command: "init",
      workingDirectory: "/repo",
      include: [],
      allow: [],
      testSources: [],
      testFiles: [],
      testExcludes: [],
    });
    assert.deepEqual(
      parseArguments(
        [
          "init",
          "--cwd",
          "/other",
          "--intent",
          "Delete account",
          "--include",
          "src/user/**",
          "--include",
          "tests/user/**",
          "--allow",
          "package.json",
          "--max-files",
          "8",
          "--max-lines",
          "300",
          "--test-source",
          "src/**/*.ts",
          "--test-file",
          "tests/**/*.test.ts",
          "--test-exclude",
          "src/**/*.d.ts",
        ],
        "/repo",
      ),
      {
        command: "init",
        workingDirectory: "/other",
        intent: "Delete account",
        include: ["src/user/**", "tests/user/**"],
        allow: ["package.json"],
        maxFiles: 8,
        maxLines: 300,
        testSources: ["src/**/*.ts"],
        testFiles: ["tests/**/*.test.ts"],
        testExcludes: ["src/**/*.d.ts"],
      },
    );
  });

  it("rejects incomplete init policies and invalid budgets", () => {
    assert.throws(
      () => parseArguments(["init", "--test-source", "src/**"], "/repo"),
      CliUsageError,
    );
    assert.throws(
      () => parseArguments(["init", "--test-exclude", "src/**"], "/repo"),
      CliUsageError,
    );
    assert.throws(() => parseArguments(["init", "--max-files", "-1"], "/repo"), CliUsageError);
    assert.throws(() => parseArguments(["init", "--max-lines", "1.5"], "/repo"), CliUsageError);
    assert.throws(() => parseArguments(["init", "--force"], "/repo"), CliUsageError);
  });
  it("parses opt-in Claude Code hook commands", () => {
    assert.deepEqual(parseArguments(["claude-hook", "capture"], "/repo"), {
      command: "claude-hook",
      action: "capture",
    });
    assert.throws(() => parseArguments(["claude-hook", "publish"], "/repo"), CliUsageError);
    assert.deepEqual(parseArguments(["codex-hook", "capture"], "/repo"), {
      command: "codex-hook",
      action: "capture",
    });
    assert.throws(() => parseArguments(["codex-hook", "publish"], "/repo"), CliUsageError);
    assert.deepEqual(parseArguments(["cursor-hook", "analyze"], "/repo"), {
      command: "cursor-hook",
      action: "analyze",
    });
    assert.throws(() => parseArguments(["cursor-hook", "clear"], "/repo"), CliUsageError);
  });
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
          "--intent-file",
          "requests/delete-user.md",
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
        intentFilePath: "requests/delete-user.md",
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
