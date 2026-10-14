/** 여러 package-manager 파서에서 같은 실패 형태를 사용한다. */
export function invalidParseResult(
  reason: string,
): Readonly<{ ok: false; kind: "invalid"; reason: string }> {
  return Object.freeze({ ok: false, kind: "invalid", reason });
}
