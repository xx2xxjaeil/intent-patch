import { isAbsolute, relative, resolve, sep } from "node:path";

/** 저장소 상대 경로가 상위 디렉터리로 탈출하지 않도록 검증하고 절대 경로로 바꾼다. */
export function resolveRepositoryPath(repositoryRoot: string, path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  const relativePath = relative(repositoryRoot, absolutePath);

  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Path is outside the repository: ${path}`);
  }

  return absolutePath;
}
