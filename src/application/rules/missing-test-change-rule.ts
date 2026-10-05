import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";

/** 테스트 정책이 요구한 소스 변경 중 대응하는 테스트 변경이 없는 파일을 보고한다. */
export class MissingTestChangeRule implements AnalysisRule {
  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    const testChanges = context.testChanges;
    if (testChanges === undefined) {
      return [];
    }

    const testPatterns = context.contract?.tests?.include.join(", ") ?? "";
    return testChanges.sourceCoverage
      .filter((coverage) => coverage.matchingTests.length === 0)
      .map((coverage) => ({
        ruleId: "tests/missing-related-change",
        severity: "medium",
        title: "Source change without matching test change",
        description: `${coverage.sourcePath} changed without a changed test sharing the same basename.`,
        file: coverage.sourcePath,
        evidence: {
          sourceChangeKind: coverage.sourceChangeKind,
          matchingStrategy: "basename",
          testPatterns,
        },
      }));
  }
}
