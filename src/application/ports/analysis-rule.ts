import type { ChangeSet } from "../../domain/change.js";
import type { ChangeContract } from "../../domain/change-contract.js";
import type { CodeStructureAnalysis } from "../../domain/code-structure.js";
import type { Finding } from "../../domain/finding.js";
import type { AnalysisTarget } from "../../domain/report.js";
import type { SymbolChangeSet } from "../../domain/symbol-change.js";
import type { TestChangeAnalysis } from "../../domain/test-change.js";

export interface AnalysisContext {
  readonly target: AnalysisTarget;
  readonly changes: ChangeSet;
  readonly contract?: ChangeContract;
  readonly testChanges?: TestChangeAnalysis;
  readonly symbolChanges?: SymbolChangeSet;
  readonly codeStructure?: CodeStructureAnalysis;
}

/**
 * 하나의 분석 관점을 캡슐화하는 규칙이다.
 * 규칙은 외부 기술을 직접 호출하지 않고 필요한 포트를 생성자로 주입받는다.
 */
export interface AnalysisRule {
  analyze(context: AnalysisContext): Promise<readonly Finding[]>;
}
