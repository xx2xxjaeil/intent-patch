export const fileChangeKinds = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "unmerged",
  "unknown",
] as const;

export type FileChangeKind = (typeof fileChangeKinds)[number];

/** 라인 수 0과 측정 불가 상태를 혼동하지 않도록 구별된 유니온으로 표현한다. */
export type LineDelta =
  | Readonly<{
      kind: "measured";
      additions: number;
      deletions: number;
    }>
  | Readonly<{
      kind: "binary";
    }>
  | Readonly<{
      kind: "unavailable";
      reason: string;
    }>;

export interface FileChange {
  readonly path: string;
  readonly previousPath?: string;
  readonly kind: FileChangeKind;
  readonly lines: LineDelta;
}

export interface ChangeSummary {
  readonly filesChanged: number;
  readonly additions: number;
  readonly deletions: number;
  readonly binaryFiles: number;
  readonly unmeasuredFiles: number;
  readonly filesByKind: Readonly<Record<FileChangeKind, number>>;
}

export interface ChangeSet {
  readonly files: readonly FileChange[];
  readonly summary: ChangeSummary;
}

/**
 * 파일 단위 변경을 정렬하고 보고서에서 재사용할 요약 통계를 한 번만 계산한다.
 * 같은 결과 경로가 두 번 들어오면 분석 결과가 모호해지므로 도메인 경계에서 거부한다.
 */
export function createChangeSet(changes: readonly FileChange[]): ChangeSet {
  assertUniquePaths(changes);

  const files = [...changes]
    .map((change) => Object.freeze({ ...change, lines: Object.freeze({ ...change.lines }) }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const filesByKind = Object.fromEntries(fileChangeKinds.map((kind) => [kind, 0])) as Record<
    FileChangeKind,
    number
  >;

  let additions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  let unmeasuredFiles = 0;

  for (const file of files) {
    filesByKind[file.kind] += 1;

    switch (file.lines.kind) {
      case "measured":
        additions += file.lines.additions;
        deletions += file.lines.deletions;
        break;
      case "binary":
        binaryFiles += 1;
        break;
      case "unavailable":
        unmeasuredFiles += 1;
        break;
    }
  }

  return Object.freeze({
    files: Object.freeze(files),
    summary: Object.freeze({
      filesChanged: files.length,
      additions,
      deletions,
      binaryFiles,
      unmeasuredFiles,
      filesByKind: Object.freeze(filesByKind),
    }),
  });
}

function assertUniquePaths(changes: readonly FileChange[]): void {
  const paths = new Set<string>();

  for (const change of changes) {
    if (paths.has(change.path)) {
      throw new Error(`Duplicate file change path: ${change.path}`);
    }
    paths.add(change.path);
  }
}
