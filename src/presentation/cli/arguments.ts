import { type Severity, severities } from "../../domain/finding.js";

export const outputFormats = ["text", "json", "html"] as const;

export type OutputFormat = (typeof outputFormats)[number];

export interface AnalyzeCommandOptions {
  readonly command: "analyze";
  readonly baseRef?: string;
  readonly headRef?: string;
  readonly workingDirectory: string;
  readonly configurationPath?: string;
  readonly intentFilePath?: string;
  readonly outputFormat: OutputFormat;
  readonly outputPath?: string;
  readonly failOn?: Severity;
}

export interface InitCommandOptions {
  readonly command: "init";
  readonly workingDirectory: string;
  readonly intent?: string;
  readonly include: readonly string[];
  readonly allow: readonly string[];
  readonly maxFiles?: number;
  readonly maxLines?: number;
  readonly testSources: readonly string[];
  readonly testFiles: readonly string[];
  readonly testExcludes: readonly string[];
}

export interface HelpCommandOptions {
  readonly command: "help";
}

export interface VersionCommandOptions {
  readonly command: "version";
}

export type ClaudeHookAction = "capture" | "analyze" | "clear";

export interface ClaudeHookCommandOptions {
  readonly command: "claude-hook";
  readonly action: ClaudeHookAction;
}

export type CodexHookAction = "capture" | "analyze" | "clear";

export interface CodexHookCommandOptions {
  readonly command: "codex-hook";
  readonly action: CodexHookAction;
}

export type CursorHookAction = "capture" | "analyze";

export interface CursorHookCommandOptions {
  readonly command: "cursor-hook";
  readonly action: CursorHookAction;
}

export type CliOptions =
  | AnalyzeCommandOptions
  | InitCommandOptions
  | ClaudeHookCommandOptions
  | CodexHookCommandOptions
  | CursorHookCommandOptions
  | HelpCommandOptions
  | VersionCommandOptions;

export class CliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function parseArguments(
  arguments_: readonly string[],
  currentDirectory: string,
): CliOptions {
  if (arguments_.length === 0 || arguments_.includes("--help") || arguments_.includes("-h")) {
    return { command: "help" };
  }
  if (arguments_.length === 1 && (arguments_[0] === "--version" || arguments_[0] === "-v")) {
    return { command: "version" };
  }

  const [command, ...options] = arguments_;
  if (command === "init") {
    return parseInitOptions(options, currentDirectory);
  }
  if (command === "claude-hook") {
    const [action] = options;
    if (
      options.length !== 1 ||
      (action !== "capture" && action !== "analyze" && action !== "clear")
    ) {
      throw new CliUsageError("Usage: intentpatch claude-hook <capture|analyze|clear>");
    }
    return { command, action };
  }
  if (command === "codex-hook") {
    const [action] = options;
    if (
      options.length !== 1 ||
      (action !== "capture" && action !== "analyze" && action !== "clear")
    ) {
      throw new CliUsageError("Usage: intentpatch codex-hook <capture|analyze|clear>");
    }
    return { command, action };
  }
  if (command === "cursor-hook") {
    const [action] = options;
    if (options.length !== 1 || (action !== "capture" && action !== "analyze")) {
      throw new CliUsageError("Usage: intentpatch cursor-hook <capture|analyze>");
    }
    return { command, action };
  }
  if (command !== "analyze") {
    throw new CliUsageError(`Unknown command: ${command ?? ""}`);
  }

  let baseRef: string | undefined;
  let headRef: string | undefined;
  let workingDirectory = currentDirectory;
  let configurationPath: string | undefined;
  let intentFilePath: string | undefined;
  let outputFormat: OutputFormat = "text";
  let outputFormatOption: "--format" | "--json" | undefined;
  let outputPath: string | undefined;
  let failOn: Severity | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    switch (option) {
      case "--base":
        baseRef = requireOptionValue(options, ++index, option);
        break;
      case "--head":
        headRef = requireOptionValue(options, ++index, option);
        break;
      case "--cwd":
        workingDirectory = requireOptionValue(options, ++index, option);
        break;
      case "--config":
        configurationPath = requireOptionValue(options, ++index, option);
        break;
      case "--intent-file":
        intentFilePath = requireOptionValue(options, ++index, option);
        break;
      case "--json":
        assertOutputFormatNotSet(outputFormatOption, option);
        outputFormat = "json";
        outputFormatOption = option;
        break;
      case "--format":
        assertOutputFormatNotSet(outputFormatOption, option);
        outputFormat = parseOutputFormat(requireOptionValue(options, ++index, option));
        outputFormatOption = option;
        break;
      case "--output":
        outputPath = requireOptionValue(options, ++index, option);
        break;
      case "--fail-on":
        failOn = parseSeverity(requireOptionValue(options, ++index, option));
        break;
      default:
        throw new CliUsageError(`Unknown option: ${option ?? ""}`);
    }
  }

  return {
    command: "analyze",
    ...(baseRef === undefined ? {} : { baseRef }),
    ...(headRef === undefined ? {} : { headRef }),
    workingDirectory,
    ...(configurationPath === undefined ? {} : { configurationPath }),
    ...(intentFilePath === undefined ? {} : { intentFilePath }),
    outputFormat,
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(failOn === undefined ? {} : { failOn }),
  };
}

export function helpText(): string {
  return `IntentPatch — evidence-based change scope analysis

Usage:
  intentpatch analyze [options]
  intentpatch init [options]                 Create .intentpatch.json without overwriting it
  intentpatch claude-hook <capture|analyze|clear>  Read Claude Code hook JSON from stdin
  intentpatch codex-hook <capture|analyze|clear>   Read Codex hook JSON from stdin
  intentpatch cursor-hook <capture|analyze>        Read Cursor hook JSON from stdin

Options:
  --base <ref>   Base Git reference (default: HEAD)
  --head <ref>   Head Git reference; omit to analyze the working tree
  --cwd <path>   Repository directory (default: current directory)
  --config <path>
                 Change contract JSON (default: <cwd>/.intentpatch.json when present)
  --intent-file <path>
                 Plain-text or Markdown request (overrides contract intent)
  --format <type> Output format: text, json, or html (default: text)
  --json         Alias for --format json
  --output <path>
                 Write the report to a file instead of standard output
  --fail-on <severity>
                 Exit with code 1 for findings at or above high, medium, or low
  init --intent <text>       Requested change (optional)
  init --include <pattern>   Expected path; repeatable (enables scope checks)
  init --allow <pattern>     Allowed exception; repeatable
  init --max-files <number>  Maximum changed files
  init --max-lines <number>  Maximum changed lines
  init --test-source <pattern>  Source path requiring a test change; repeatable
  init --test-file <pattern>    Test file path; repeatable
  init --test-exclude <pattern> Excluded source path; repeatable
  -v, --version  Show the installed IntentPatch version
  -h, --help     Show this help
`;
}

function parseInitOptions(
  options: readonly string[],
  currentDirectory: string,
): InitCommandOptions {
  let workingDirectory = currentDirectory;
  let intent: string | undefined;
  const include: string[] = [];
  const allow: string[] = [];
  let maxFiles: number | undefined;
  let maxLines: number | undefined;
  const testSources: string[] = [];
  const testFiles: string[] = [];
  const testExcludes: string[] = [];

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    switch (option) {
      case "--cwd":
        workingDirectory = requireOptionValue(options, ++index, option);
        break;
      case "--intent":
        intent = requireOptionValue(options, ++index, option);
        break;
      case "--include":
        include.push(requireOptionValue(options, ++index, option));
        break;
      case "--allow":
        allow.push(requireOptionValue(options, ++index, option));
        break;
      case "--max-files":
        maxFiles = parseBudget(requireOptionValue(options, ++index, option), option);
        break;
      case "--max-lines":
        maxLines = parseBudget(requireOptionValue(options, ++index, option), option);
        break;
      case "--test-source":
        testSources.push(requireOptionValue(options, ++index, option));
        break;
      case "--test-file":
        testFiles.push(requireOptionValue(options, ++index, option));
        break;
      case "--test-exclude":
        testExcludes.push(requireOptionValue(options, ++index, option));
        break;
      default:
        throw new CliUsageError(`Unknown init option: ${option ?? ""}`);
    }
  }
  if ((testSources.length === 0) !== (testFiles.length === 0)) {
    throw new CliUsageError("--test-source and --test-file must be used together");
  }
  if (testExcludes.length > 0 && testSources.length === 0) {
    throw new CliUsageError("--test-exclude requires --test-source and --test-file");
  }
  return {
    command: "init",
    workingDirectory,
    ...(intent === undefined ? {} : { intent }),
    include,
    allow,
    ...(maxFiles === undefined ? {} : { maxFiles }),
    ...(maxLines === undefined ? {} : { maxLines }),
    testSources,
    testFiles,
    testExcludes,
  };
}

function parseBudget(value: string, option: string): number {
  const number = Number(value);
  if (!/^(0|[1-9]\d*)$/u.test(value) || !Number.isSafeInteger(number)) {
    throw new CliUsageError(`${option} must be a non-negative integer`);
  }
  return number;
}

function parseOutputFormat(value: string): OutputFormat {
  if (outputFormats.some((format) => format === value)) {
    return value as OutputFormat;
  }
  throw new CliUsageError(`Invalid output format: ${value}`);
}

function assertOutputFormatNotSet(
  currentOption: "--format" | "--json" | undefined,
  nextOption: "--format" | "--json",
): void {
  if (currentOption !== undefined) {
    throw new CliUsageError(
      `Output format already set by ${currentOption}; cannot use ${nextOption}`,
    );
  }
}

function parseSeverity(value: string): Severity {
  if (severities.some((severity) => severity === value)) {
    return value as Severity;
  }
  throw new CliUsageError(`Invalid severity for --fail-on: ${value}`);
}

function requireOptionValue(options: readonly string[], index: number, optionName: string): string {
  const value = options[index];
  if (value === undefined || value.startsWith("--")) {
    throw new CliUsageError(`Missing value for ${optionName}`);
  }
  return value;
}
