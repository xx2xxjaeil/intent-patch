/** Node 파일 API가 돌려주는 파일 없음 오류인지 확인한다. */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
