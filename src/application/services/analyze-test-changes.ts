import { posix } from "node:path";
import { createTestChangeAnalysis, type TestChangeAnalysis } from "../../domain/test-change.js";
import type { AnalysisContext } from "../ports/analysis-rule.js";
import type { TestChangeAnalyzer } from "../ports/test-change-analyzer.js";
import { matchesPathPattern } from "./path-pattern.js";

const sourceExtension = /\.(?:[cm]?[jt]sx?)$/u;
const testSuffix = /\.(?:(?:unit|integration|e2e)\.)?(?:test|spec)$/u;

/** 변경 파일을 테스트 정책으로 분류하고 파일명 기반 관련 테스트를 연결한다. */
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

    return createTestChangeAnalysis({
      testFiles,
      sourceCoverage: sourceFiles.map((source) => ({
        sourcePath: source.path,
        sourceChangeKind: source.kind,
        matchingTests: testFiles
          .filter((test) => testIdentity(test.path) === sourceIdentity(source.path))
          .map((test) => test.path),
      })),
    });
  }
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
