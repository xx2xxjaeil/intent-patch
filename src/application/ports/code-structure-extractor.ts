export interface FunctionImplementationFact {
  readonly name: string;
  readonly line: number;
  readonly implementationFingerprint: string;
  readonly tokenCount: number;
}

export interface InterfaceDeclarationFact {
  readonly name: string;
  readonly line: number;
}

export interface ClassImplementationFact {
  readonly name: string;
  readonly line: number;
  readonly implementedTypes: readonly string[];
}

export interface CodeStructureFacts {
  readonly functions: readonly FunctionImplementationFact[];
  readonly interfaces: readonly InterfaceDeclarationFact[];
  readonly classes: readonly ClassImplementationFact[];
}

export type CodeStructureExtractionResult =
  | Readonly<{ kind: "success"; facts: CodeStructureFacts }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

/** 언어별 소스에서 구조 신호에 필요한 최소 사실만 추출하는 입력 포트다. */
export interface CodeStructureExtractor {
  supports(path: string): boolean;
  extract(path: string, source: string): CodeStructureExtractionResult;
}
