/** pnpm v9 lockfile의 프로젝트 패키지 목록에서 비교할 사실이다. */
export interface PnpmLockedPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly rootDirect: boolean;
}

export type PnpmLockParseResult =
  | Readonly<{ ok: true; packages: ReadonlyMap<string, PnpmLockedPackage> }>
  | Readonly<{ ok: false; kind: "invalid" | "unsupported"; reason: string }>;

/** YAML 파일 형식 해석을 분석 규칙에서 분리하는 입력 포트다. */
export interface PnpmLockParser {
  parse(content: string): PnpmLockParseResult;
}
