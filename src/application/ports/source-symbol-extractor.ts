import type { SourceSymbol } from "../../domain/symbol-change.js";

export type SymbolExtractionResult =
  | Readonly<{ kind: "success"; symbols: readonly SourceSymbol[] }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

/** 언어별 구문 분석기를 application 계층에서 교체할 수 있게 하는 출력 포트다. */
export interface SourceSymbolExtractor {
  supports(path: string): boolean;
  extract(path: string, source: string): SymbolExtractionResult;
}
