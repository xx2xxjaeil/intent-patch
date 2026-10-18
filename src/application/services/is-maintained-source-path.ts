const generatedDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "action-dist",
  ".next",
  ".turbo",
]);

/** 추적 중인 빌드 산출물은 분석 입력에서 제외해 원본 변경을 중복 집계하지 않는다. */
export function isMaintainedSourcePath(path: string): boolean {
  return !path.split("/").some((part) => generatedDirectories.has(part));
}
