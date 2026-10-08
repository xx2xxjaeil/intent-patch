export interface GitHubComparison {
  readonly baseRef: string;
  readonly headRef: string;
}

export interface ExplicitComparison {
  readonly baseRef?: string;
  readonly headRef?: string;
}

/** GitHub webhook payload에서 재현 가능한 commit 비교 범위를 결정한다. */
export function resolveGitHubComparison(
  explicit: ExplicitComparison,
  eventName: string | undefined,
  payload: unknown,
): GitHubComparison {
  if (explicit.baseRef !== undefined && explicit.headRef !== undefined) {
    return { baseRef: explicit.baseRef, headRef: explicit.headRef };
  }

  if (eventName === "pull_request" || eventName === "pull_request_target") {
    return {
      baseRef: readNestedString(payload, ["pull_request", "base", "sha"], eventName),
      headRef: readNestedString(payload, ["pull_request", "head", "sha"], eventName),
    };
  }

  if (eventName === "push") {
    const baseRef = readNestedString(payload, ["before"], eventName);
    const headRef = readNestedString(payload, ["after"], eventName);
    if (/^0+$/.test(baseRef)) {
      throw new Error(
        "A new-branch push has no base commit; provide both 'base' and 'head' inputs",
      );
    }
    return { baseRef, headRef };
  }

  return { baseRef: "HEAD^", headRef: "HEAD" };
}

function readNestedString(value: unknown, path: readonly string[], eventName: string): string {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      throw new Error(`GitHub ${eventName} payload is missing ${path.join(".")}`);
    }
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  if (typeof current !== "string" || current.length === 0) {
    throw new Error(`GitHub ${eventName} payload has an invalid ${path.join(".")}`);
  }
  return current;
}
