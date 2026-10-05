import type { AnalysisTarget } from "../../domain/report.js";

export interface TextFileSnapshot {
  readonly before?: string;
  readonly after?: string;
}

/** 분석 기준점과 결과점에서 동일한 텍스트 파일을 읽는 출력 포트다. */
export interface FileSnapshotSource {
  read(target: AnalysisTarget, path: string, basePath?: string): Promise<TextFileSnapshot>;
}
