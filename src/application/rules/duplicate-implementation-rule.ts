import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";

/** 새 함수의 구현이 기존 함수와 같을 때 재사용 가능성을 검토하도록 알린다. */
export class DuplicateImplementationRule implements AnalysisRule {
  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    return (context.codeStructure?.duplicateCandidates ?? []).map((candidate) => ({
      ruleId: "structure/duplicate-implementation",
      severity: "medium",
      title: "New function duplicates existing implementation",
      description: `The new function ${candidate.added.name} has the same normalized implementation as ${candidate.existing.name}.`,
      file: candidate.added.path,
      evidence: {
        addedFunction: candidate.added.name,
        addedLine: candidate.added.line,
        existingFunction: candidate.existing.name,
        existingFile: candidate.existing.path,
        existingLine: candidate.existing.line,
      },
    }));
  }
}
