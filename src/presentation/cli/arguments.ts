import { type Severity, severities } from "../../domain/finding.js";

export type OutputFormat = "text" | "json";

export interface AnalyzeCommandOptions {
  readonly command: "analyze";
  readonly baseRef?: string;
  readonly headRef?: string;
  readonly workingDirectory: string;
  readonly configurationPath?: string;
  readonly outputFormat: OutputFormat;
  readonly failOn?: Severity;
}

export interface HelpCommandOptions {
  readonly command: "help";
}

export type CliOptions = AnalyzeCommandOptions | HelpCommandOptions;

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

  const [command, ...options] = arguments_;
  if (command !== "analyze") {
    throw new CliUsageError(`Unknown command: ${command ?? ""}`);
  }

  let baseRef: string | undefined;
  let headRef: string | undefined;
  let workingDirectory = currentDirectory;
  let configurationPath: string | undefined;
  let outputFormat: OutputFormat = "text";
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
      case "--json":
        outputFormat = "json";
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
    outputFormat,
    ...(failOn === undefined ? {} : { failOn }),
  };
}

export function helpText(): string {
  return `IntentPatch — evidence-based change scope analysis

Usage:
  intentpatch analyze [options]

Options:
  --base <ref>   Base Git reference (default: HEAD)
  --head <ref>   Head Git reference; omit to analyze the working tree
  --cwd <path>   Repository directory (default: current directory)
  --config <path>
                 Change contract JSON (default: <cwd>/.intentpatch.json when present)
  --json         Print machine-readable JSON
  --fail-on <severity>
                 Exit with code 1 for findings at or above high, medium, or low
  -h, --help     Show this help
`;
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
