import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type { Finding, Severity } from "../../domain/finding.js";
import type { ActionInputSource } from "./action-inputs.js";

export interface GitHubActionRuntime extends ActionInputSource {
  getEnvironment(name: string): string | undefined;
  setOutput(name: string, value: string): Promise<void>;
  addSummary(markdown: string): Promise<void>;
  annotate(finding: Finding): void;
  info(message: string): void;
  error(message: string): void;
}

export class EnvironmentGitHubActionRuntime implements GitHubActionRuntime {
  public constructor(private readonly environment: NodeJS.ProcessEnv) {}

  public getInput(name: string): string | undefined {
    const value = this.environment[`INPUT_${name.toUpperCase().replaceAll(" ", "_")}`]?.trim();
    return value === undefined || value.length === 0 ? undefined : value;
  }

  public getEnvironment(name: string): string | undefined {
    const value = this.environment[name]?.trim();
    return value === undefined || value.length === 0 ? undefined : value;
  }

  public async setOutput(name: string, value: string): Promise<void> {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error(`Invalid GitHub Action output name: ${name}`);
    }
    const outputFile = this.getEnvironment("GITHUB_OUTPUT");
    if (outputFile === undefined) {
      return;
    }
    const delimiter = `intentpatch_${randomUUID()}`;
    await appendFile(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, "utf8");
  }

  public async addSummary(markdown: string): Promise<void> {
    const summaryFile = this.getEnvironment("GITHUB_STEP_SUMMARY");
    if (summaryFile !== undefined) {
      await appendFile(summaryFile, markdown, "utf8");
    }
  }

  public annotate(finding: Finding): void {
    const level = annotationLevel[finding.severity];
    const file = escapeWorkflowProperty(finding.file);
    const title = escapeWorkflowProperty(`IntentPatch: ${finding.title}`);
    const message = escapeWorkflowData(`[${finding.ruleId}] ${finding.description}`);
    console.log(`::${level} file=${file},title=${title}::${message}`);
  }

  public info(message: string): void {
    console.log(message);
  }

  public error(message: string): void {
    console.error(`::error title=IntentPatch::${escapeWorkflowData(message)}`);
  }
}

const annotationLevel: Readonly<Record<Severity, "error" | "warning" | "notice">> = {
  high: "error",
  medium: "warning",
  low: "notice",
};

function escapeWorkflowData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeWorkflowProperty(value: string): string {
  return escapeWorkflowData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}
