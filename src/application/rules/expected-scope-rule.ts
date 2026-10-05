import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import { matchesPathPattern } from "../services/path-pattern.js";

/** 명시된 예상·허용 경로 밖의 변경을 파일별 근거와 함께 보고한다. */
export class ExpectedScopeRule implements AnalysisRule {
  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    const contract = context.contract;
    if (contract === undefined || contract.scope.include.length === 0) {
      return [];
    }

    const patterns = [...contract.scope.include, ...contract.scope.allow];
    return context.changes.files
      .filter((file) => !patterns.some((pattern) => matchesPathPattern(file.path, pattern)))
      .map((file) => ({
        ruleId: "scope/outside-expected-path",
        severity: "medium",
        title: "Change outside expected scope",
        description: `${file.path} does not match any expected or allowed path pattern.`,
        file: file.path,
        evidence: {
          path: file.path,
          expectedPatterns: contract.scope.include.join(", "),
          allowedPatterns: contract.scope.allow.join(", "),
          ...(contract.intent === undefined ? {} : { intent: contract.intent }),
        },
      }));
  }
}
