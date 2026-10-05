import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FileChange, LineDelta } from "../../domain/change.js";
import type { CommandRunner } from "../process/command-runner.js";

const maximumMeasuredFileSize = 10 * 1024 * 1024;

export async function collectUntrackedFiles(
  repositoryRoot: string,
  commandRunner: CommandRunner,
): Promise<FileChange[]> {
  const output = await commandRunner.run({
    executable: "git",
    arguments: ["ls-files", "--others", "--exclude-standard", "-z"],
    cwd: repositoryRoot,
  });
  const paths = output.split("\0").filter((path) => path.length > 0);
  const changes: FileChange[] = [];

  // Deliberately sequential: an unbounded Promise.all can exhaust file descriptors in large repos.
  for (const path of paths) {
    const absolutePath = safeRepositoryPath(repositoryRoot, path);
    changes.push({
      path,
      kind: "added",
      lines: await measureUntrackedFile(absolutePath),
    });
  }

  return changes;
}

async function measureUntrackedFile(path: string): Promise<LineDelta> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    return { kind: "unavailable", reason: "Symbolic links are not read." };
  }
  if (!metadata.isFile()) {
    return { kind: "unavailable", reason: "Path is not a regular file." };
  }
  if (metadata.size > maximumMeasuredFileSize) {
    return { kind: "unavailable", reason: "File exceeds the 10 MiB measurement limit." };
  }

  const content = await readFile(path);
  if (content.includes(0)) {
    return { kind: "binary" };
  }
  if (content.length === 0) {
    return { kind: "measured", additions: 0, deletions: 0 };
  }

  let lineCount = 0;
  for (const byte of content) {
    if (byte === 10) {
      lineCount += 1;
    }
  }
  if (content.at(-1) !== 10) {
    lineCount += 1;
  }

  return { kind: "measured", additions: lineCount, deletions: 0 };
}

function safeRepositoryPath(repositoryRoot: string, path: string): string {
  // 심볼릭 링크는 위에서 읽지 않으며, Git이 저장소 밖의 경로를 반환하는 경우도 차단한다.
  const absolutePath = resolve(repositoryRoot, path);
  const relativePath = relative(repositoryRoot, absolutePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Git returned a path outside the repository: ${path}`);
  }
  return absolutePath;
}
