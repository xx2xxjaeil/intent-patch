import { createFindingSet, type FindingSet } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";

/** 독립 규칙을 병렬 실행하고 결과 순서를 도메인 팩토리에 맡긴다. */
export class RuleEngine {
  public constructor(private readonly rules: readonly AnalysisRule[]) {}

  public async run(context: AnalysisContext): Promise<FindingSet> {
    const results = await Promise.all(this.rules.map((rule) => rule.analyze(context)));
    return createFindingSet(results.flat());
  }
}
