import { ChangeBudgetRule } from "../application/rules/change-budget-rule.js";
import { DuplicateImplementationRule } from "../application/rules/duplicate-implementation-rule.js";
import { ExpectedScopeRule } from "../application/rules/expected-scope-rule.js";
import { MissingTestChangeRule } from "../application/rules/missing-test-change-rule.js";
import { PackageDependencyRule } from "../application/rules/package-dependency-rule.js";
import { PublicApiCompatibilityRule } from "../application/rules/public-api-compatibility-rule.js";
import { PublicApiRemovalRule } from "../application/rules/public-api-removal-rule.js";
import { SingleImplementationAbstractionRule } from "../application/rules/single-implementation-abstraction-rule.js";
import { AnalyzeCodeStructure } from "../application/services/analyze-code-structure.js";
import { AnalyzeImportImpact } from "../application/services/analyze-import-impact.js";
import { AnalyzeTestChanges } from "../application/services/analyze-test-changes.js";
import { CompareSourceSymbols } from "../application/services/compare-source-symbols.js";
import { RuleEngine } from "../application/services/rule-engine.js";
import { AnalyzeChanges } from "../application/use-cases/analyze-changes.js";
import type { ChangeReport } from "../domain/report.js";
import { JsonChangeContractLoader } from "../infrastructure/config/json-change-contract-loader.js";
import { GitChangeSource } from "../infrastructure/git/git-change-source.js";
import { GitFileSnapshotSource } from "../infrastructure/git/git-file-snapshot-source.js";
import { GitProjectFileSource } from "../infrastructure/git/git-project-file-source.js";
import { NodeCommandRunner } from "../infrastructure/process/command-runner.js";
import { TypeScriptCodeStructureExtractor } from "../infrastructure/typescript/typescript-code-structure-extractor.js";
import { TypeScriptModuleReferenceExtractor } from "../infrastructure/typescript/typescript-module-reference-extractor.js";
import { TypeScriptSymbolExtractor } from "../infrastructure/typescript/typescript-symbol-extractor.js";

export interface RepositoryAnalysisOptions {
  readonly workingDirectory: string;
  readonly baseRef?: string;
  readonly headRef?: string;
  readonly configurationPath?: string;
}

/** CLI와 자동화 어댑터가 동일한 분석 구성과 규칙 집합을 사용하도록 조립을 공유한다. */
export async function analyzeRepository(options: RepositoryAnalysisOptions): Promise<ChangeReport> {
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
    new PublicApiCompatibilityRule(),
    new DuplicateImplementationRule(),
    new SingleImplementationAbstractionRule(),
  ]);
  const symbolChangeAnalyzer = new CompareSourceSymbols(snapshotSource, [
    new TypeScriptSymbolExtractor(),
  ]);
  const projectFiles = new GitProjectFileSource(options.workingDirectory, commandRunner);
  const impactAnalyzer = new AnalyzeImportImpact(projectFiles, [
    new TypeScriptModuleReferenceExtractor(),
  ]);
  const codeStructureAnalyzer = new AnalyzeCodeStructure(projectFiles, [
    new TypeScriptCodeStructureExtractor(),
  ]);
  const useCase = new AnalyzeChanges(
    new GitChangeSource(options.workingDirectory, commandRunner),
    ruleEngine,
    symbolChangeAnalyzer,
    impactAnalyzer,
    new AnalyzeTestChanges(),
    codeStructureAnalyzer,
  );

  return useCase.execute({
    ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef }),
    ...(options.headRef === undefined ? {} : { headRef: options.headRef }),
    ...(contract === undefined ? {} : { contract }),
  });
}
