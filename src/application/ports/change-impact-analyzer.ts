import type { ImpactAnalysis } from "../../domain/impact.js";
import type { AnalysisContext } from "./analysis-rule.js";

export interface ChangeImpactAnalyzer {
  analyze(context: AnalysisContext): Promise<ImpactAnalysis>;
}
