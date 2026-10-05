export interface ChangeScope {
  readonly include: readonly string[];
  readonly allow: readonly string[];
  readonly maxFiles?: number;
  readonly maxLines?: number;
}

export interface TestChangePolicy {
  readonly requireFor: readonly string[];
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

export interface ChangeContract {
  readonly intent?: string;
  readonly scope: ChangeScope;
  readonly tests?: TestChangePolicy;
}

export interface CreateChangeContractInput {
  readonly intent?: string;
  readonly scope?: Readonly<{
    include?: readonly string[];
    allow?: readonly string[];
    maxFiles?: number;
    maxLines?: number;
  }>;
  readonly tests?: Readonly<{
    requireFor?: readonly string[];
    include?: readonly string[];
    exclude?: readonly string[];
  }>;
}

/** 사용자 기대 범위를 정규화해 규칙마다 설정 해석이 달라지지 않게 한다. */
export function createChangeContract(input: CreateChangeContractInput): ChangeContract {
  const intent = normalizeIntent(input.intent);
  const scope = input.scope ?? {};
  const include = normalizePatterns(scope.include ?? [], "scope.include");
  const allow = normalizePatterns(scope.allow ?? [], "scope.allow");
  const maxFiles = normalizeBudget(scope.maxFiles, "maxFiles");
  const maxLines = normalizeBudget(scope.maxLines, "maxLines");
  const tests = normalizeTestPolicy(input.tests);

  return Object.freeze({
    ...(intent === undefined ? {} : { intent }),
    scope: Object.freeze({
      include: Object.freeze(include),
      allow: Object.freeze(allow),
      ...(maxFiles === undefined ? {} : { maxFiles }),
      ...(maxLines === undefined ? {} : { maxLines }),
    }),
    ...(tests === undefined ? {} : { tests }),
  });
}

function normalizeTestPolicy(
  input: CreateChangeContractInput["tests"],
): TestChangePolicy | undefined {
  if (input === undefined) {
    return undefined;
  }

  const requireFor = normalizePatterns(input.requireFor ?? [], "tests.requireFor");
  const include = normalizePatterns(input.include ?? [], "tests.include");
  const exclude = normalizePatterns(input.exclude ?? [], "tests.exclude");
  if (requireFor.length === 0) {
    throw new Error("Change contract tests.requireFor must contain at least one pattern.");
  }
  if (include.length === 0) {
    throw new Error("Change contract tests.include must contain at least one pattern.");
  }

  return Object.freeze({
    requireFor: Object.freeze(requireFor),
    include: Object.freeze(include),
    exclude: Object.freeze(exclude),
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

function normalizePatterns(values: readonly string[], field: string): string[] {
  const patterns = values.map((value) => normalizePattern(value, field));
  return [...new Set(patterns)].sort((left, right) => left.localeCompare(right));
}

function normalizePattern(value: string, field: string): string {
  let pattern = value.trim().replaceAll("\\", "/");
  while (pattern.startsWith("./")) {
    pattern = pattern.slice(2);
  }

  if (pattern.length === 0) {
    throw new Error(`Change contract ${field} must not contain a blank pattern.`);
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
