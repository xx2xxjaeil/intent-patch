import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";

/** 새 인터페이스를 구현하는 클래스가 하나뿐이면 추상화 필요성을 검토하도록 알린다. */
export class SingleImplementationAbstractionRule implements AnalysisRule {
  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    return (context.codeStructure?.singleImplementationAbstractions ?? []).map((candidate) => ({
      ruleId: "structure/single-implementation-abstraction",
      severity: "low",
      title: "New interface has one implementation",
      description: `The new interface ${candidate.abstraction.name} is implemented only by ${candidate.implementation.name}.`,
      file: candidate.abstraction.path,
      evidence: {
        interfaceName: candidate.abstraction.name,
        interfaceLine: candidate.abstraction.line,
        implementationName: candidate.implementation.name,
        implementationFile: candidate.implementation.path,
        implementationLine: candidate.implementation.line,
      },
    }));
  }
}
