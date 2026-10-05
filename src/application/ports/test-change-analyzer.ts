import type { TestChangeAnalysis } from "../../domain/test-change.js";
import type { AnalysisContext } from "./analysis-rule.js";

export interface TestChangeAnalyzer {
  analyze(context: AnalysisContext): Promise<TestChangeAnalysis>;
}
