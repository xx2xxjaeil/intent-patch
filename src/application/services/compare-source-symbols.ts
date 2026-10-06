import {
  createSymbolChangeSet,
  type SourceSymbol,
  type SymbolAnalysisIssue,
  type SymbolChange,
  type SymbolChangeSet,
} from "../../domain/symbol-change.js";
import type { AnalysisContext } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";
import type {
  SourceSymbolExtractor,
  SymbolExtractionResult,
} from "../ports/source-symbol-extractor.js";
import type { SymbolChangeAnalyzer } from "../ports/symbol-change-analyzer.js";

/** 변경 파일의 이전·현재 심볼을 비교하되 언어별 AST 구현은 extractor에 위임한다. */
export class CompareSourceSymbols implements SymbolChangeAnalyzer {
  public constructor(
    private readonly snapshots: FileSnapshotSource,
    private readonly extractors: readonly SourceSymbolExtractor[],
  ) {}

  public async analyze(context: AnalysisContext): Promise<SymbolChangeSet> {
    const changes: SymbolChange[] = [];
    const issues: SymbolAnalysisIssue[] = [];
    let filesAnalyzed = 0;

    // 파일 수가 큰 저장소에서 Git 프로세스를 무제한 생성하지 않도록 순차 분석한다.
    for (const file of context.changes.files) {
      const extractor = this.extractors.find((candidate) => candidate.supports(file.path));
      if (extractor === undefined) {
        continue;
      }

      const basePath =
        file.kind === "renamed" && file.previousPath !== undefined ? file.previousPath : file.path;
      const snapshot = await this.snapshots.read(context.target, file.path, basePath);
      const before = extractSnapshot(extractor, basePath, snapshot.before);
      const after = extractSnapshot(extractor, file.path, snapshot.after);

      if (before.kind === "unavailable" || after.kind === "unavailable") {
        const reasons = [
          ...(before.kind === "unavailable" ? [`base: ${before.reason}`] : []),
          ...(after.kind === "unavailable" ? [`current: ${after.reason}`] : []),
        ];
        issues.push({ path: file.path, reason: reasons.join("; ") });
        continue;
      }

      filesAnalyzed += 1;
      changes.push(...compareFileSymbols(file.path, before.symbols, after.symbols));
    }

    return createSymbolChangeSet(changes, issues, filesAnalyzed);
  }
}

function extractSnapshot(
  extractor: SourceSymbolExtractor,
  path: string,
  source: string | undefined,
): SymbolExtractionResult {
  return source === undefined ? { kind: "success", symbols: [] } : extractor.extract(path, source);
}

function compareFileSymbols(
  path: string,
  before: readonly SourceSymbol[],
  after: readonly SourceSymbol[],
): SymbolChange[] {
  const previousSymbols = indexSymbols(before);
  const currentSymbols = indexSymbols(after);
  const identities = [...new Set([...previousSymbols.keys(), ...currentSymbols.keys()])].sort();
  const changes: SymbolChange[] = [];

  for (const identity of identities) {
    const previous = previousSymbols.get(identity);
    const current = currentSymbols.get(identity);

    if (previous === undefined && current !== undefined) {
      changes.push({
        path,
        name: current.name,
        symbolKind: current.kind,
        changeKind: "added",
        afterLine: current.line,
        ...(current.exported === undefined ? {} : { afterExported: current.exported }),
        ...(current.publicApi === undefined ? {} : { afterPublicApi: current.publicApi }),
      });
      continue;
    }
    if (previous !== undefined && current === undefined) {
      changes.push({
        path,
        name: previous.name,
        symbolKind: previous.kind,
        changeKind: "deleted",
        beforeLine: previous.line,
        ...(previous.exported === undefined ? {} : { beforeExported: previous.exported }),
        ...(previous.publicApi === undefined ? {} : { beforePublicApi: previous.publicApi }),
      });
      continue;
    }
    if (
      previous !== undefined &&
      current !== undefined &&
      (previous.fingerprint !== current.fingerprint || previous.exported !== current.exported)
    ) {
      changes.push({
        path,
        name: current.name,
        symbolKind: current.kind,
        changeKind: "modified",
        beforeLine: previous.line,
        afterLine: current.line,
        ...(previous.exported === undefined ? {} : { beforeExported: previous.exported }),
        ...(current.exported === undefined ? {} : { afterExported: current.exported }),
        ...(previous.publicApi === undefined ? {} : { beforePublicApi: previous.publicApi }),
        ...(current.publicApi === undefined ? {} : { afterPublicApi: current.publicApi }),
      });
    }
  }

  return changes;
}

function indexSymbols(symbols: readonly SourceSymbol[]): ReadonlyMap<string, SourceSymbol> {
  const indexed = new Map<string, SourceSymbol>();

  for (const symbol of symbols) {
    const identity = `${symbol.kind}\0${symbol.name}`;
    if (indexed.has(identity)) {
      throw new Error(`Duplicate extracted symbol: ${symbol.kind} ${symbol.name}`);
    }
    indexed.set(identity, symbol);
  }

  return indexed;
}
