import { type Severity, severities } from "../../domain/finding.js";

export interface GitHubActionInputs {
  readonly workingDirectory: string;
  readonly configurationPath?: string;
  readonly intentFilePath?: string;
  readonly intentFromPrBody: boolean;
  readonly reportDirectory: string;
  readonly baseRef?: string;
  readonly headRef?: string;
  readonly failOn: Severity;
}

export interface ActionInputSource {
  getInput(name: string): string | undefined;
}

export function readGitHubActionInputs(source: ActionInputSource): GitHubActionInputs {
  const baseRef = source.getInput("base");
  const headRef = source.getInput("head");
  const configurationPath = source.getInput("config");
  const intentFilePath = source.getInput("intent-file");
  if ((baseRef === undefined) !== (headRef === undefined)) {
    throw new Error("GitHub Action inputs 'base' and 'head' must be provided together");
  }

  return {
    workingDirectory: source.getInput("working-directory") ?? ".",
    reportDirectory: source.getInput("report-directory") ?? "intentpatch-report",
    failOn: parseSeverity(source.getInput("fail-on") ?? "high"),
    intentFromPrBody: parseBoolean(source.getInput("intent-from-pr-body") ?? "false"),
    ...(configurationPath === undefined ? {} : { configurationPath }),
    ...(intentFilePath === undefined ? {} : { intentFilePath }),
    ...(baseRef === undefined ? {} : { baseRef }),
    ...(headRef === undefined ? {} : { headRef }),
  };
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid GitHub Action intent-from-pr-body value: ${value}`);
}

function parseSeverity(value: string): Severity {
  if (severities.some((severity) => severity === value)) {
    return value as Severity;
  }
  throw new Error(`Invalid GitHub Action fail-on severity: ${value}`);
}
