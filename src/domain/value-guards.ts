/** JSON/YAML 입력의 객체 형태를 계층에 관계없이 같은 기준으로 검사한다. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
