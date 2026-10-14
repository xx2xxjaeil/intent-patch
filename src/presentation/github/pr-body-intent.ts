const maximumPullRequestIntentLength = 8_192;

/** PR 본문은 명시적으로 요청했을 때만 intent 후보로 사용하고, 누락·과대 입력은 건너뛴다. */
export function pullRequestBodyIntent(
  eventName: string | undefined,
  payload: unknown,
): string | undefined {
  if (eventName !== "pull_request" && eventName !== "pull_request_target") return undefined;
  if (!isRecord(payload) || !isRecord(payload.pull_request)) return undefined;
  const body = payload.pull_request.body;
  if (typeof body !== "string") return undefined;
  const intent = body.trim();
  return intent.length > 0 && intent.length <= maximumPullRequestIntentLength ? intent : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
