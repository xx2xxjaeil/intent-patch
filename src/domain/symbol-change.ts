export const sourceSymbolKinds = [
  "function",
  "class",
  "interface",
  "type-alias",
  "re-export",
] as const;
export const symbolChangeKinds = ["added", "modified", "deleted"] as const;

export type SourceSymbolKind = (typeof sourceSymbolKinds)[number];
export type SymbolChangeKind = (typeof symbolChangeKinds)[number];

export interface FunctionPublicApi {
  readonly kind: "function";
  readonly signatures: readonly string[];
}

export interface InterfacePublicApiMember {
  readonly name: string;
  readonly memberKind: "property" | "method";
  readonly optional: boolean;
  readonly signature: string;
}

export interface InterfacePublicApi {
  readonly kind: "interface";
  readonly extendsTypes: readonly string[];
  readonly members: readonly InterfacePublicApiMember[];
}

export type PublicApi = FunctionPublicApi | InterfacePublicApi;

/** 파서가 추출한 심볼의 비교용 표현이다. fingerprint는 보고서에 노출하지 않는다. */
export interface SourceSymbol {
  readonly name: string;
  readonly kind: SourceSymbolKind;
  readonly fingerprint: string;
  readonly line: number;
  /** 언어 어댑터가 공개 여부를 판단할 수 없으면 undefined로 남긴다. */
  readonly exported?: boolean;
  /** 구현 본문을 제외한 공개 계약이다. 지원하지 않는 심볼 종류에는 존재하지 않는다. */
  readonly publicApi?: PublicApi;
}

export interface SymbolChange {
  readonly path: string;
  readonly name: string;
  readonly symbolKind: SourceSymbolKind;
  readonly changeKind: SymbolChangeKind;
  readonly beforeLine?: number;
  readonly afterLine?: number;
  readonly beforeExported?: boolean;
  readonly afterExported?: boolean;
  readonly beforePublicApi?: PublicApi;
  readonly afterPublicApi?: PublicApi;
}

export interface SymbolAnalysisIssue {
  readonly path: string;
  readonly reason: string;
}

export interface SymbolChangeSummary {
  readonly total: number;
  readonly filesAnalyzed: number;
  readonly filesUnavailable: number;
  readonly byChangeKind: Readonly<Record<SymbolChangeKind, number>>;
}

export interface SymbolChangeSet {
  readonly changes: readonly SymbolChange[];
  readonly issues: readonly SymbolAnalysisIssue[];
  readonly summary: SymbolChangeSummary;
}

const changeKindRank: Readonly<Record<SymbolChangeKind, number>> = {
  added: 0,
  modified: 1,
  deleted: 2,
};

export function createSymbolChangeSet(
  changes: readonly SymbolChange[],
  issues: readonly SymbolAnalysisIssue[] = [],
  filesAnalyzed = 0,
): SymbolChangeSet {
  assertUniqueChanges(changes);

  const sortedChanges = [...changes].map(freezeChange).sort(compareChanges);
  const sortedIssues = [...issues]
    .map((issue) => Object.freeze({ ...issue }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const byChangeKind: Record<SymbolChangeKind, number> = {
    added: 0,
    modified: 0,
    deleted: 0,
  };

  for (const change of sortedChanges) {
    byChangeKind[change.changeKind] += 1;
  }

  return Object.freeze({
    changes: Object.freeze(sortedChanges),
    issues: Object.freeze(sortedIssues),
    summary: Object.freeze({
      total: sortedChanges.length,
      filesAnalyzed,
      filesUnavailable: sortedIssues.length,
      byChangeKind: Object.freeze(byChangeKind),
    }),
  });
}

function freezeChange(change: SymbolChange): Readonly<SymbolChange> {
  return Object.freeze({
    ...change,
    ...(change.beforePublicApi === undefined
      ? {}
      : { beforePublicApi: freezePublicApi(change.beforePublicApi) }),
    ...(change.afterPublicApi === undefined
      ? {}
      : { afterPublicApi: freezePublicApi(change.afterPublicApi) }),
  });
}

function freezePublicApi(publicApi: PublicApi): PublicApi {
  if (publicApi.kind === "function") {
    return Object.freeze({
      kind: publicApi.kind,
      signatures: Object.freeze([...publicApi.signatures]),
    });
  }
  return Object.freeze({
    kind: publicApi.kind,
    extendsTypes: Object.freeze([...publicApi.extendsTypes]),
    members: Object.freeze(publicApi.members.map((member) => Object.freeze({ ...member }))),
  });
}

function compareChanges(left: SymbolChange, right: SymbolChange): number {
  return (
    left.path.localeCompare(right.path) ||
    changeKindRank[left.changeKind] - changeKindRank[right.changeKind] ||
    left.symbolKind.localeCompare(right.symbolKind) ||
    left.name.localeCompare(right.name)
  );
}

function assertUniqueChanges(changes: readonly SymbolChange[]): void {
  const identities = new Set<string>();

  for (const change of changes) {
    const identity = [change.path, change.symbolKind, change.name].join("\0");
    if (identities.has(identity)) {
      throw new Error(
        `Duplicate symbol change: ${change.path} ${change.symbolKind} ${change.name}`,
      );
    }
    identities.add(identity);
  }
}
