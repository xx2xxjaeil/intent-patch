import { posix } from "node:path";
import { createTestChangeAnalysis, type TestChangeAnalysis } from "../../domain/test-change.js";
import type { AnalysisContext } from "../ports/analysis-rule.js";
import type { TestChangeAnalyzer } from "../ports/test-change-analyzer.js";
import { matchesPathPattern } from "./path-pattern.js";

const sourceExtension = /\.(?:[cm]?[jt]sx?)$/u;
const testSuffix = /\.(?:(?:unit|integration|e2e)\.)?(?:test|spec)$/u;

/** 변경 파일을 테스트 정책으로 분류하고 명시적 매핑·정적 import·파일명 근거로 연결한다. */
export class AnalyzeTestChanges implements TestChangeAnalyzer {
  public async analyze(context: AnalysisContext): Promise<TestChangeAnalysis> {
    const policy = context.contract?.tests;
    if (policy === undefined) {
      return createTestChangeAnalysis({ testFiles: [], sourceCoverage: [] });
    }

    const testFiles = context.changes.files
      .filter((file) => matchesAny(file.path, policy.include))
      .map((file) => ({ path: file.path, changeKind: file.kind }));
    const sourceFiles = context.changes.files.filter(
      (file) =>
        !matchesAny(file.path, policy.include) &&
        matchesAny(file.path, policy.requireFor) &&
        !matchesAny(file.path, policy.exclude),
    );
    const imports = context.impact?.dependencies ?? [];
    const importedBy = new Map<string, Set<string>>();
    for (const dependency of imports) {
      const targets = importedBy.get(dependency.importer) ?? new Set<string>();
      targets.add(dependency.imported);
      importedBy.set(dependency.importer, targets);
    }
    const importedPathsByTest = new Map(
      testFiles.map((test) => [test.path, reachableImports(test.path, importedBy)]),
    );

    return createTestChangeAnalysis({
      testFiles,
      sourceCoverage: sourceFiles.map((source) => ({
        sourcePath: source.path,
        sourceChangeKind: source.kind,
        matchingTests: testFiles
          .filter(
            (test) =>
              (Object.hasOwn(policy.related ?? {}, source.path)
                ? (policy.related?.[source.path] ?? []).some((path) =>
                    matchesPathPattern(test.path, path),
                  )
                : testIdentity(test.path) === sourceIdentity(source.path) ||
                  (importedPathsByTest.get(test.path)?.has(source.path) ?? false)) &&
              (source.kind === "deleted" || test.changeKind !== "deleted"),
          )
          .map((test) => test.path),
      })),
    });
  }
}

function reachableImports(
  testPath: string,
  importedBy: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const seen = new Set([testPath]);
  const queue = [testPath];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) continue;
    for (const imported of importedBy.get(current) ?? []) {
      if (!seen.has(imported)) {
        seen.add(imported);
        queue.push(imported);
      }
    }
  }
  seen.delete(testPath);
  return seen;
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPathPattern(path, pattern));
}

function sourceIdentity(path: string): string {
  return posix.basename(path).replace(sourceExtension, "");
}

function testIdentity(path: string): string {
  return sourceIdentity(path).replace(testSuffix, "");
}
