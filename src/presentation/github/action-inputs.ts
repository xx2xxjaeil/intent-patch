import { type Severity, severities } from "../../domain/finding.js";

export interface GitHubActionInputs {
  readonly workingDirectory: string;
  readonly configurationPath?: string;
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
  if ((baseRef === undefined) !== (headRef === undefined)) {
    throw new Error("GitHub Action inputs 'base' and 'head' must be provided together");
  }

  return {
    workingDirectory: source.getInput("working-directory") ?? ".",
    reportDirectory: source.getInput("report-directory") ?? "intentpatch-report",
    failOn: parseSeverity(source.getInput("fail-on") ?? "high"),
    ...(configurationPath === undefined ? {} : { configurationPath }),
    ...(baseRef === undefined ? {} : { baseRef }),
    ...(headRef === undefined ? {} : { headRef }),
  };
}

function parseSeverity(value: string): Severity {
  if (severities.some((severity) => severity === value)) {
    return value as Severity;
  }
  throw new Error(`Invalid GitHub Action fail-on severity: ${value}`);
}
