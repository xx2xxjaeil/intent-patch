import type { ImpactAnalysisIssue } from "../../domain/impact.js";
import type { AnalysisTarget } from "../../domain/report.js";
import type { ProjectSnapshot } from "./project-file-source.js";

/** 분석 결과점에서 해석 가능한 비상대 경로 import를 찾는 언어별 출력 포트다. */
export interface ModuleAliasResolver {
  prepare(
    target: AnalysisTarget,
    repositoryPaths: readonly string[],
    sourcePaths: ReadonlySet<string>,
    snapshot?: ProjectSnapshot,
  ): Promise<PreparedModuleAliasResolver>;
}

export interface PreparedModuleAliasResolver {
  readonly issues: readonly ImpactAnalysisIssue[];
  resolve(importer: string, specifier: string): string | undefined;
}
