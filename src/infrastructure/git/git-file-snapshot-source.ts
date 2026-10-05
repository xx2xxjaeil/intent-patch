import { lstat, readFile } from "node:fs/promises";
import type {
  FileSnapshotSource,
  TextFileSnapshot,
} from "../../application/ports/file-snapshot-source.js";
import type { AnalysisTarget } from "../../domain/report.js";
import { resolveRepositoryPath } from "../filesystem/repository-path.js";
import { type CommandRunner, NodeCommandRunner } from "../process/command-runner.js";

const maximumTextFileSize = 1024 * 1024;

/** Git 기준점과 working tree 또는 head ref에서 분석용 텍스트를 읽는다. */
export class GitFileSnapshotSource implements FileSnapshotSource {
  public constructor(
    private readonly workingDirectory: string,
    private readonly commandRunner: CommandRunner = new NodeCommandRunner(),
  ) {}

  public async read(
    target: AnalysisTarget,
    path: string,
    basePath = path,
  ): Promise<TextFileSnapshot> {
    const repositoryRoot = (
      await this.commandRunner.run({
        executable: "git",
        arguments: ["rev-parse", "--show-toplevel"],
        cwd: this.workingDirectory,
      })
    ).trim();
    const baseRevision = await this.resolveBaseRevision(repositoryRoot, target);

    const [before, after] = await Promise.all([
      this.readRevision(repositoryRoot, baseRevision, basePath),
      target.headRef === undefined
        ? this.readWorkingTree(repositoryRoot, path)
        : this.readRevision(repositoryRoot, target.headRef, path),
    ]);

    return {
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    };
  }

  private async resolveBaseRevision(
    repositoryRoot: string,
    target: AnalysisTarget,
  ): Promise<string> {
    if (target.headRef === undefined) {
      return target.baseRef;
    }

    return (
      await this.commandRunner.run({
        executable: "git",
        arguments: ["merge-base", target.baseRef, target.headRef],
        cwd: repositoryRoot,
      })
    ).trim();
  }

  private async readRevision(
    repositoryRoot: string,
    revision: string,
    path: string,
  ): Promise<string | undefined> {
    resolveRepositoryPath(repositoryRoot, path);
    const listedPaths = await this.commandRunner.run({
      executable: "git",
      arguments: ["ls-tree", "--name-only", "-z", revision, "--", path],
      cwd: repositoryRoot,
    });

    if (!listedPaths.split("\0").includes(path)) {
      return undefined;
    }

    return this.commandRunner.run({
      executable: "git",
      arguments: ["show", `${revision}:${path}`],
      cwd: repositoryRoot,
    });
  }

  private async readWorkingTree(repositoryRoot: string, path: string): Promise<string | undefined> {
    const absolutePath = resolveRepositoryPath(repositoryRoot, path);
    let metadata: Awaited<ReturnType<typeof lstat>>;

    try {
      metadata = await lstat(absolutePath);
    } catch (error) {
      if (isFileNotFound(error)) {
        return undefined;
      }
      throw error;
    }

    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing to read a symbolic link: ${path}`);
    }
    if (!metadata.isFile()) {
      throw new Error(`Expected a regular file: ${path}`);
    }
    if (metadata.size > maximumTextFileSize) {
      throw new Error(`Text file exceeds the 1 MiB analysis limit: ${path}`);
    }

    return readFile(absolutePath, "utf8");
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
