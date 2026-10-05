#!/usr/bin/env node

import process from "node:process";
import { PackageDependencyRule } from "../../application/rules/package-dependency-rule.js";
import { AnalyzeImportImpact } from "../../application/services/analyze-import-impact.js";
import { CompareSourceSymbols } from "../../application/services/compare-source-symbols.js";
import { RuleEngine } from "../../application/services/rule-engine.js";
import { AnalyzeChanges } from "../../application/use-cases/analyze-changes.js";
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
import { formatTextReport } from "./text-report.js";

async function main(): Promise<void> {
  try {
    const options = parseArguments(process.argv.slice(2), process.cwd());
    if (options.command === "help") {
      process.stdout.write(helpText());
      return;
    }

    // 구체 어댑터 조립은 가장 바깥 계층인 CLI 진입점에서만 수행한다.
    const commandRunner = new NodeCommandRunner();
    const snapshotSource = new GitFileSnapshotSource(options.workingDirectory, commandRunner);
    const ruleEngine = new RuleEngine([new PackageDependencyRule(snapshotSource)]);
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
    );
    const report = await useCase.execute({
      ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef }),
      ...(options.headRef === undefined ? {} : { headRef: options.headRef }),
    });

    const output =
      options.outputFormat === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatTextReport(report);
    process.stdout.write(output);

    if (options.failOn !== undefined && shouldFail(report.findings.items, options.failOn)) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = error instanceof CliUsageError ? 2 : 1;
  }
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
