export type ModuleReferenceExtractionResult =
  | Readonly<{ kind: "success"; specifiers: readonly string[] }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

/** 소스 파일에서 정적 module specifier를 추출하는 언어별 출력 포트다. */
export interface ModuleReferenceExtractor {
  supports(path: string): boolean;
  extract(path: string, source: string): ModuleReferenceExtractionResult;
}
