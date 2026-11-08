import type { FileChange } from "../../domain/change.js";
import type { ChangeContract } from "../../domain/change-contract.js";
import { matchesPathPattern } from "./path-pattern.js";

export interface IntentFileTrace {
  readonly path: string;
  readonly relation: "expected" | "allowed" | "outside" | "unclassified";
  readonly patterns: readonly string[];
}

/** 명시된 계약 경로와 실제 변경 파일의 관계만 기록한다. 자연어 의도는 추정하지 않는다. */
export function traceIntentToFiles(
  contract: ChangeContract,
  files: readonly FileChange[],
): readonly IntentFileTrace[] {
  return files.map((file) => {
    const expected = contract.scope.include.filter((pattern) =>
      matchesPathPattern(file.path, pattern),
    );
    if (expected.length > 0) {
      return { path: file.path, relation: "expected", patterns: expected };
    }
    const allowed = contract.scope.allow.filter((pattern) =>
      matchesPathPattern(file.path, pattern),
    );
    if (allowed.length > 0) {
      return { path: file.path, relation: "allowed", patterns: allowed };
    }
    return {
      path: file.path,
      relation: contract.scope.include.length > 0 ? "outside" : "unclassified",
      patterns: [],
    };
  });
}
