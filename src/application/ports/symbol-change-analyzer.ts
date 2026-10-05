import type { SymbolChangeSet } from "../../domain/symbol-change.js";
import type { AnalysisContext } from "./analysis-rule.js";

export interface SymbolChangeAnalyzer {
  analyze(context: AnalysisContext): Promise<SymbolChangeSet>;
}
