/** Yarn 4 lockfile에서 검증된 레지스트리 해석 결과만 전달한다. */
export interface YarnLockedPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly rootDirect: boolean;
}

export type YarnLockParseResult =
  | Readonly<{ ok: true; packages: ReadonlyMap<string, YarnLockedPackage> }>
  | Readonly<{ ok: false; kind: "invalid" | "unsupported"; reason: string }>;

export interface YarnLockParser {
  parse(content: string): YarnLockParseResult;
}
