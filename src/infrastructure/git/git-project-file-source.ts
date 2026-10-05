import { lstat, readFile } from "node:fs/promises";
import type {
  ProjectFileReadResult,
  ProjectFileSource,
} from "../../application/ports/project-file-source.js";
import type { AnalysisTarget } from "../../domain/report.js";
import { resolveRepositoryPath } from "../filesystem/repository-path.js";
import { type CommandRunner, NodeCommandRunner } from "../process/command-runner.js";

const maximumTextFileSize = 1024 * 1024;

/** 분석 결과점의 tracked·untracked 파일 목록과 텍스트를 Git 저장소에서 읽는다. */
export class GitProjectFileSource implements ProjectFileSource {
  private repositoryRootPromise: Promise<string> | undefined;

  public constructor(
    private readonly workingDirectory: string,
    private readonly commandRunner: CommandRunner = new NodeCommandRunner(),
  ) {}

  public async listPaths(target: AnalysisTarget): Promise<readonly string[]> {
    const repositoryRoot = await this.repositoryRoot();
    const output =
      target.headRef === undefined
        ? await this.commandRunner.run({
            executable: "git",
            arguments: ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd: repositoryRoot,
          })
        : await this.commandRunner.run({
            executable: "git",
            arguments: ["ls-tree", "-r", "--name-only", "-z", target.headRef, "--"],
            cwd: repositoryRoot,
          });

    return [...new Set(output.split("\0").filter((path) => path.length > 0))].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  public async read(target: AnalysisTarget, path: string): Promise<ProjectFileReadResult> {
    const repositoryRoot = await this.repositoryRoot();

    try {
      resolveRepositoryPath(repositoryRoot, path);
      return target.headRef === undefined
        ? await this.readWorkingTree(repositoryRoot, path)
        : await this.readRevision(repositoryRoot, target.headRef, path);
    } catch (error) {
      return {
        kind: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private repositoryRoot(): Promise<string> {
    this.repositoryRootPromise ??= this.commandRunner
      .run({
        executable: "git",
        arguments: ["rev-parse", "--show-toplevel"],
        cwd: this.workingDirectory,
      })
      .then((output) => output.trim());
    return this.repositoryRootPromise;
  }

  private async readRevision(
    repositoryRoot: string,
    revision: string,
    path: string,
  ): Promise<ProjectFileReadResult> {
    const listedPaths = await this.commandRunner.run({
      executable: "git",
      arguments: ["ls-tree", "--name-only", "-z", revision, "--", path],
      cwd: repositoryRoot,
    });
    if (!listedPaths.split("\0").includes(path)) {
      return { kind: "missing" };
    }

    const size = Number.parseInt(
      (
        await this.commandRunner.run({
          executable: "git",
          arguments: ["cat-file", "-s", `${revision}:${path}`],
          cwd: repositoryRoot,
        })
      ).trim(),
      10,
    );
    if (!Number.isFinite(size)) {
      return { kind: "unavailable", reason: `Could not determine file size: ${path}` };
    }
    if (size > maximumTextFileSize) {
      return { kind: "unavailable", reason: `Text file exceeds the 1 MiB analysis limit: ${path}` };
    }

    return {
      kind: "success",
      content: await this.commandRunner.run({
        executable: "git",
        arguments: ["show", `${revision}:${path}`],
        cwd: repositoryRoot,
      }),
    };
  }

  private async readWorkingTree(
    repositoryRoot: string,
    path: string,
  ): Promise<ProjectFileReadResult> {
    const absolutePath = resolveRepositoryPath(repositoryRoot, path);
    let metadata: Awaited<ReturnType<typeof lstat>>;

    try {
      metadata = await lstat(absolutePath);
    } catch (error) {
      if (isFileNotFound(error)) {
        return { kind: "missing" };
      }
      throw error;
    }

    if (metadata.isSymbolicLink()) {
      return { kind: "unavailable", reason: `Refusing to read a symbolic link: ${path}` };
    }
    if (!metadata.isFile()) {
      return { kind: "unavailable", reason: `Expected a regular file: ${path}` };
    }
    if (metadata.size > maximumTextFileSize) {
      return { kind: "unavailable", reason: `Text file exceeds the 1 MiB analysis limit: ${path}` };
    }

    return { kind: "success", content: await readFile(absolutePath, "utf8") };
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
