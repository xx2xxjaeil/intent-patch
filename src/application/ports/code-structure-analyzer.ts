import type { CodeStructureAnalysis } from "../../domain/code-structure.js";
import type { AnalysisContext } from "./analysis-rule.js";

export interface CodeStructureAnalyzer {
  analyze(context: AnalysisContext): Promise<CodeStructureAnalysis>;
}
