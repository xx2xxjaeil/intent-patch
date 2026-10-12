/** npm lockfile의 설치 위치를 기준으로 비교할 수 있는 패키지 정보다. */
export interface LockedPackage {
  readonly path: string;
  readonly name: string;
  readonly version: string;
  readonly rootDirect: boolean;
}

export type PackageLockParseResult =
  | Readonly<{ ok: true; packages: ReadonlyMap<string, LockedPackage> }>
  | Readonly<{ ok: false; kind: "invalid" | "unsupported"; reason: string }>;

/** 패키지 매니저의 파일 형식을 분석 규칙에서 분리하는 입력 포트다. */
export interface PackageLockParser {
  parse(content: string): PackageLockParseResult;
}
