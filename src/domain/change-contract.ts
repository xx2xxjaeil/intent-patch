export interface ChangeScope {
  readonly include: readonly string[];
  readonly allow: readonly string[];
  readonly maxFiles?: number;
  readonly maxLines?: number;
}

export interface ChangeContract {
  readonly intent?: string;
  readonly scope: ChangeScope;
}

export interface CreateChangeContractInput {
  readonly intent?: string;
  readonly scope?: Readonly<{
    include?: readonly string[];
    allow?: readonly string[];
    maxFiles?: number;
    maxLines?: number;
  }>;
}

/** 사용자 기대 범위를 정규화해 규칙마다 설정 해석이 달라지지 않게 한다. */
export function createChangeContract(input: CreateChangeContractInput): ChangeContract {
  const intent = normalizeIntent(input.intent);
  const scope = input.scope ?? {};
  const include = normalizePatterns(scope.include ?? [], "include");
  const allow = normalizePatterns(scope.allow ?? [], "allow");
  const maxFiles = normalizeBudget(scope.maxFiles, "maxFiles");
  const maxLines = normalizeBudget(scope.maxLines, "maxLines");

  return Object.freeze({
    ...(intent === undefined ? {} : { intent }),
    scope: Object.freeze({
      include: Object.freeze(include),
      allow: Object.freeze(allow),
      ...(maxFiles === undefined ? {} : { maxFiles }),
      ...(maxLines === undefined ? {} : { maxLines }),
    }),
  });
}

function normalizeIntent(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const intent = value.trim();
  if (intent.length === 0) {
    throw new Error("Change contract intent must not be blank.");
  }
  return intent;
}

function normalizePatterns(values: readonly string[], field: "include" | "allow"): string[] {
  const patterns = values.map((value) => normalizePattern(value, field));
  return [...new Set(patterns)].sort((left, right) => left.localeCompare(right));
}

function normalizePattern(value: string, field: "include" | "allow"): string {
  let pattern = value.trim().replaceAll("\\", "/");
  while (pattern.startsWith("./")) {
    pattern = pattern.slice(2);
  }

  if (pattern.length === 0) {
    throw new Error(`Change contract scope.${field} must not contain a blank pattern.`);
  }
  if (pattern.startsWith("/") || pattern.split("/").includes("..")) {
    throw new Error(`Change contract patterns must be repository-relative: ${value}`);
  }
  return pattern;
}

function normalizeBudget(value: number | undefined, field: "maxFiles" | "maxLines") {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Change contract scope.${field} must be a non-negative integer.`);
  }
  return value;
}
