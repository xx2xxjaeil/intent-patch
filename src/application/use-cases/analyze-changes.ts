import type { ChangeReport } from "../../domain/report.js";
import type { ChangeSource } from "../ports/change-source.js";

export interface AnalyzeChangesInput {
  readonly baseRef?: string;
  readonly headRef?: string;
}

/**
 * 분석 입력을 정규화하고 변경사항 수집을 조율하는 유스케이스다.
 * Git 명령이나 출력 형식은 외부 계층에 위임해 핵심 흐름을 기술 세부사항과 분리한다.
 */
export class AnalyzeChanges {
  public constructor(private readonly changeSource: ChangeSource) {}

  public async execute(input: AnalyzeChangesInput = {}): Promise<ChangeReport> {
    const baseRef = input.baseRef?.trim() || "HEAD";
    const headRef = input.headRef?.trim() || undefined;
    assertSafeGitRef(baseRef);
    if (headRef !== undefined) {
      assertSafeGitRef(headRef);
    }
    const target = headRef === undefined ? { baseRef } : { baseRef, headRef };

    return {
      target,
      changes: await this.changeSource.collect(target),
    };
  }
}

function assertSafeGitRef(ref: string): void {
  if (ref.startsWith("-")) {
    throw new Error(`Git references must not start with a hyphen: ${ref}`);
  }
}
