import type { WorkspacePatterns } from "../services/workspace-manifest-analysis.js";

export type PnpmWorkspaceParseResult =
  | Readonly<{ ok: true; patterns: WorkspacePatterns }>
  | Readonly<{ ok: false; kind: "invalid" | "unsupported"; reason: string }>;

/** pnpm 설정 파일을 workspace glob 사실로 바꾸는 출력 포트다. */
export interface PnpmWorkspaceParser {
  parse(content: string | undefined): PnpmWorkspaceParseResult;
}
