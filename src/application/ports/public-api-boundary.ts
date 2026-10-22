import type { AnalysisTarget } from "../../domain/report.js";

/** 확인 가능한 package exports 경계 밖에 있던 변경 파일만 반환한다. */
export interface PublicApiBoundary {
  internalPaths(
    target: AnalysisTarget,
    changedPaths: readonly string[],
  ): Promise<ReadonlySet<string>>;
}
