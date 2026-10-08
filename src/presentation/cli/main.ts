#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { CommandExecutionError } from "../../infrastructure/process/command-runner.js";
import { analyzeRepository } from "../analyze-repository.js";
import { CliUsageError, helpText, parseArguments } from "./arguments.js";
import { shouldFail } from "./failure-policy.js";
import { writeReportFile } from "./report-file-writer.js";
import { formatReport } from "./report-formatter.js";

async function main(): Promise<void> {
  try {
    const invocationDirectory = process.cwd();
    const options = parseArguments(process.argv.slice(2), invocationDirectory);
    if (options.command === "help") {
      process.stdout.write(helpText());
      return;
    }
    if (options.command === "version") {
      process.stdout.write(`IntentPatch ${await readPackageVersion()}\n`);
      return;
    }

    const report = await analyzeRepository({
      workingDirectory: options.workingDirectory,
      ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef }),
      ...(options.headRef === undefined ? {} : { headRef: options.headRef }),
      ...(options.configurationPath === undefined
        ? {}
        : { configurationPath: options.configurationPath }),
    });

    const output = formatReport(report, options.outputFormat);
    if (options.outputPath === undefined) {
      process.stdout.write(output);
    } else {
      const destination = await writeReportFile(output, options.outputPath, invocationDirectory);
      process.stdout.write(`IntentPatch report written to ${destination}\n`);
    }

    if (options.failOn !== undefined && shouldFail(report.findings.items, options.failOn)) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = error instanceof CliUsageError ? 2 : 1;
  }
}

async function readPackageVersion(): Promise<string> {
  const packageUrl = new URL("../../../package.json", import.meta.url);
  const packageMetadata: unknown = JSON.parse(await readFile(packageUrl, "utf8"));
  if (!isPackageMetadata(packageMetadata)) {
    throw new Error("IntentPatch package metadata does not contain a valid version");
  }
  return packageMetadata.version;
}

function isPackageMetadata(value: unknown): value is { readonly version: string } {
  if (typeof value !== "object" || value === null || !("version" in value)) {
    return false;
  }
  return typeof value.version === "string" && value.version.trim().length > 0;
}

function formatError(error: unknown): string {
  if (error instanceof CliUsageError) {
    return `${error.message}\n\n${helpText()}`;
  }
  if (error instanceof CommandExecutionError) {
    return `Git command failed: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

await main();
