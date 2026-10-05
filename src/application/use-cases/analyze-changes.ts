import type { ChangeReport } from "../../domain/report.js";
import { createSymbolChangeSet } from "../../domain/symbol-change.js";
import type { ChangeSource } from "../ports/change-source.js";
import type { SymbolChangeAnalyzer } from "../ports/symbol-change-analyzer.js";
import { RuleEngine } from "../services/rule-engine.js";

export interface AnalyzeChangesInput {
  readonly baseRef?: string;
  readonly headRef?: string;
}

const emptySymbolChangeAnalyzer: SymbolChangeAnalyzer = {
  analyze: async () => createSymbolChangeSet([]),
};

/**
 * 분석 입력을 정규화하고 변경사항 수집을 조율하는 유스케이스다.
 * Git 명령이나 출력 형식은 외부 계층에 위임해 핵심 흐름을 기술 세부사항과 분리한다.
 */
export class AnalyzeChanges {
  public constructor(
    private readonly changeSource: ChangeSource,
    private readonly ruleEngine: RuleEngine = new RuleEngine([]),
    private readonly symbolChangeAnalyzer: SymbolChangeAnalyzer = emptySymbolChangeAnalyzer,
  ) {}

  public async execute(input: AnalyzeChangesInput = {}): Promise<ChangeReport> {
    const baseRef = input.baseRef?.trim() || "HEAD";
    const headRef = input.headRef?.trim() || undefined;
    assertSafeGitRef(baseRef);
    if (headRef !== undefined) {
      assertSafeGitRef(headRef);
    }
    const target = headRef === undefined ? { baseRef } : { baseRef, headRef };

    const changes = await this.changeSource.collect(target);
    const context = { target, changes };
    const [findings, symbolChanges] = await Promise.all([
      this.ruleEngine.run(context),
      this.symbolChangeAnalyzer.analyze(context),
    ]);

    return {
      target,
      changes,
      findings,
      symbolChanges,
    };
  }
}

function assertSafeGitRef(ref: string): void {
  if (ref.startsWith("-")) {
    throw new Error(`Git references must not start with a hyphen: ${ref}`);
  }
}
