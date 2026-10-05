import type { Finding } from "../../domain/finding.js";
import type { SymbolChange } from "../../domain/symbol-change.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";

/** 확인 가능한 공개 심볼의 삭제와 export 해제를 호환성 위험으로 보고한다. */
export class PublicApiRemovalRule implements AnalysisRule {
  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    return (context.symbolChanges?.changes ?? []).flatMap(toFinding);
  }
}

function toFinding(change: SymbolChange): Finding[] {
  if (change.changeKind === "deleted" && change.beforeExported === true) {
    return [
      {
        ruleId: "api/exported-symbol-removed",
        severity: "high",
        title: "Exported symbol removed",
        description: `The exported ${change.symbolKind} ${change.name} was removed.`,
        file: change.path,
        evidence: {
          symbolName: change.name,
          symbolKind: change.symbolKind,
          ...(change.beforeLine === undefined ? {} : { previousLine: change.beforeLine }),
        },
      },
    ];
  }

  if (
    change.changeKind === "modified" &&
    change.beforeExported === true &&
    change.afterExported === false
  ) {
    return [
      {
        ruleId: "api/export-removed",
        severity: "high",
        title: "Public export removed",
        description: `The ${change.symbolKind} ${change.name} is no longer exported.`,
        file: change.path,
        evidence: {
          symbolName: change.name,
          symbolKind: change.symbolKind,
          ...(change.beforeLine === undefined ? {} : { previousLine: change.beforeLine }),
          ...(change.afterLine === undefined ? {} : { currentLine: change.afterLine }),
        },
      },
    ];
  }

  return [];
}
