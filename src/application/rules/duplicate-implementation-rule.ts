import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";

/** 새 함수·메서드의 확인 가능한 동일 구현을 재사용 후보로 보고한다. */
export class DuplicateImplementationRule implements AnalysisRule {
  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    return (context.codeStructure?.duplicateCandidates ?? []).map((candidate) => ({
      ruleId: "structure/duplicate-implementation",
      severity: "medium",
      title:
        candidate.addedKind === "method"
          ? "New method duplicates existing implementation"
          : "New function duplicates existing implementation",
      description: `The new ${candidate.addedKind === "method" ? "method" : "function"} ${candidate.added.name} has the same ${candidate.matchKind === "renamed-locals" ? "structure after local-name normalization" : "normalized implementation"} as ${candidate.existing.name}.`,
      file: candidate.added.path,
      evidence: {
        addedFunction: candidate.added.name,
        addedLine: candidate.added.line,
        existingFunction: candidate.existing.name,
        existingFile: candidate.existing.path,
        existingLine: candidate.existing.line,
        ...(candidate.matchKind === undefined ? {} : { matchKind: candidate.matchKind }),
      },
    }));
  }
}
