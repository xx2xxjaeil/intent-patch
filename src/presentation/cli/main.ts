#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { ChangeBudgetRule } from "../../application/rules/change-budget-rule.js";
import { ExpectedScopeRule } from "../../application/rules/expected-scope-rule.js";
import { MissingTestChangeRule } from "../../application/rules/missing-test-change-rule.js";
import { PackageDependencyRule } from "../../application/rules/package-dependency-rule.js";
import { PublicApiRemovalRule } from "../../application/rules/public-api-removal-rule.js";
import { AnalyzeImportImpact } from "../../application/services/analyze-import-impact.js";
import { AnalyzeTestChanges } from "../../application/services/analyze-test-changes.js";
import { CompareSourceSymbols } from "../../application/services/compare-source-symbols.js";
import { RuleEngine } from "../../application/services/rule-engine.js";
import { AnalyzeChanges } from "../../application/use-cases/analyze-changes.js";
import { JsonChangeContractLoader } from "../../infrastructure/config/json-change-contract-loader.js";
import { GitChangeSource } from "../../infrastructure/git/git-change-source.js";
import { GitFileSnapshotSource } from "../../infrastructure/git/git-file-snapshot-source.js";
import { GitProjectFileSource } from "../../infrastructure/git/git-project-file-source.js";
import {
  CommandExecutionError,
  NodeCommandRunner,
} from "../../infrastructure/process/command-runner.js";
import { TypeScriptModuleReferenceExtractor } from "../../infrastructure/typescript/typescript-module-reference-extractor.js";
import { TypeScriptSymbolExtractor } from "../../infrastructure/typescript/typescript-symbol-extractor.js";
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

    // 구체 어댑터 조립은 가장 바깥 계층인 CLI 진입점에서만 수행한다.
    const commandRunner = new NodeCommandRunner();
    const snapshotSource = new GitFileSnapshotSource(options.workingDirectory, commandRunner);
    const contract = await new JsonChangeContractLoader().load(
      options.workingDirectory,
      options.configurationPath,
    );
    const ruleEngine = new RuleEngine([
      new PackageDependencyRule(snapshotSource),
      new ExpectedScopeRule(),
      new ChangeBudgetRule(),
      new MissingTestChangeRule(),
      new PublicApiRemovalRule(),
    ]);
    const symbolChangeAnalyzer = new CompareSourceSymbols(snapshotSource, [
      new TypeScriptSymbolExtractor(),
    ]);
    const impactAnalyzer = new AnalyzeImportImpact(
      new GitProjectFileSource(options.workingDirectory, commandRunner),
      [new TypeScriptModuleReferenceExtractor()],
    );
    const useCase = new AnalyzeChanges(
      new GitChangeSource(options.workingDirectory, commandRunner),
      ruleEngine,
      symbolChangeAnalyzer,
      impactAnalyzer,
      new AnalyzeTestChanges(),
    );
    const report = await useCase.execute({
      ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef }),
      ...(options.headRef === undefined ? {} : { headRef: options.headRef }),
      ...(contract === undefined ? {} : { contract }),
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
