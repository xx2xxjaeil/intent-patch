import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isSeverityAtLeast } from "../../domain/finding.js";
import type { ChangeReport } from "../../domain/report.js";
import { resolveRepositoryPath } from "../../infrastructure/filesystem/repository-path.js";
import { analyzeRepository } from "../analyze-repository.js";
import { formatHtmlReport } from "../html/html-report.js";
import { readGitHubActionInputs } from "./action-inputs.js";
import type { GitHubActionRuntime } from "./action-runtime.js";
import { resolveGitHubComparison } from "./comparison.js";
import { formatGitHubSummary } from "./markdown-summary.js";

export interface GitHubActionResult {
  readonly qualityGateFailed: boolean;
  readonly message?: string;
}

export async function runGitHubAction(runtime: GitHubActionRuntime): Promise<GitHubActionResult> {
  const inputs = readGitHubActionInputs(runtime);
  const workspace = requireEnvironment(runtime, "GITHUB_WORKSPACE");
  const workingDirectory = resolveRepositoryPath(workspace, inputs.workingDirectory);
  const eventName = runtime.getEnvironment("GITHUB_EVENT_NAME");
  const payload = await readEventPayload(runtime.getEnvironment("GITHUB_EVENT_PATH"));
  const comparison = resolveGitHubComparison(inputs, eventName, payload);

  runtime.info(`IntentPatch analyzing ${comparison.baseRef}...${comparison.headRef}`);
  const report = await analyzeRepository({
    workingDirectory,
    baseRef: comparison.baseRef,
    headRef: comparison.headRef,
    ...(inputs.configurationPath === undefined
      ? {}
      : { configurationPath: inputs.configurationPath }),
  });
  const reportDirectory = resolveRepositoryPath(workspace, inputs.reportDirectory);
  const reportPaths = await writeReports(report, reportDirectory);

  await runtime.addSummary(formatGitHubSummary(report));
  for (const finding of report.findings.items.slice(0, 50)) {
    runtime.annotate(finding);
  }
  await writeOutputs(runtime, report, reportPaths);

  const qualityGateFailed = report.findings.items.some((finding) =>
    isSeverityAtLeast(finding.severity, inputs.failOn),
  );
  return {
    qualityGateFailed,
    ...(qualityGateFailed
      ? { message: `Findings at or above '${inputs.failOn}' failed the quality gate` }
      : {}),
  };
}

async function readEventPayload(path: string | undefined): Promise<unknown> {
  if (path === undefined) {
    return undefined;
  }
  const source = await readFile(path, "utf8");
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`GitHub event payload is not valid JSON: ${path}`);
  }
}

async function writeReports(
  report: ChangeReport,
  reportDirectory: string,
): Promise<{ readonly json: string; readonly html: string }> {
  await mkdir(reportDirectory, { recursive: true });
  const json = resolve(reportDirectory, "intentpatch-report.json");
  const html = resolve(reportDirectory, "intentpatch-report.html");
  await Promise.all([
    writeFile(json, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(html, formatHtmlReport(report), "utf8"),
  ]);
  return { json, html };
}

async function writeOutputs(
  runtime: GitHubActionRuntime,
  report: ChangeReport,
  paths: { readonly json: string; readonly html: string },
): Promise<void> {
  const { summary } = report.findings;
  await Promise.all([
    runtime.setOutput("json-report", paths.json),
    runtime.setOutput("html-report", paths.html),
    runtime.setOutput("findings", String(summary.total)),
    runtime.setOutput("high-findings", String(summary.bySeverity.high)),
    runtime.setOutput("medium-findings", String(summary.bySeverity.medium)),
    runtime.setOutput("low-findings", String(summary.bySeverity.low)),
  ]);
}

function requireEnvironment(runtime: GitHubActionRuntime, name: string): string {
  const value = runtime.getEnvironment(name);
  if (value === undefined) {
    throw new Error(`GitHub Action environment variable is missing: ${name}`);
  }
  return value;
}
