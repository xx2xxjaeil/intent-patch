import type { AnalysisTarget } from "../../domain/report.js";

export type ProjectFileReadResult =
  | Readonly<{ kind: "success"; content: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

/** 분석 결과점의 프로젝트 파일 목록과 텍스트를 공급하는 출력 포트다. */
export interface ProjectFileSource {
  listPaths(target: AnalysisTarget): Promise<readonly string[]>;
  read(target: AnalysisTarget, path: string): Promise<ProjectFileReadResult>;
}
