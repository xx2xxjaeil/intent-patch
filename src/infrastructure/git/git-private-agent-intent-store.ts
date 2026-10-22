import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentIntentSessionStore,
  CapturedAgentIntent,
} from "../../application/ports/agent-intent-session-store.js";
import { type CommandRunner, NodeCommandRunner } from "../process/command-runner.js";

const maximumSnapshotBytes = 80 * 1024;

/** Git 메타데이터의 소유자 전용 디렉터리에 턴 요청을 잠시 보관한다. */
export class GitPrivateAgentIntentStore implements AgentIntentSessionStore {
  public constructor(private readonly commands: CommandRunner = new NodeCommandRunner()) {}

  public async capture(sessionId: string, workingDirectory: string, intent: string): Promise<void> {
    const { statePath, repositoryRoot } = await this.location(sessionId, workingDirectory);
    const baseRef = (
      await this.commands.run({
        executable: "git",
        arguments: ["rev-parse", "HEAD"],
        cwd: workingDirectory,
      })
    ).trim();
    if (!/^[0-9a-f]{40,64}$/u.test(baseRef)) {
      throw new Error("Claude Code hook requires a repository with an existing HEAD commit");
    }

    const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify({ repositoryRoot, baseRef, intent }), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, statePath);
    } finally {
      await unlink(temporaryPath).catch(ignoreMissing);
    }
  }

  public async take(
    sessionId: string,
    workingDirectory: string,
  ): Promise<CapturedAgentIntent | undefined> {
    const { statePath, repositoryRoot } = await this.location(sessionId, workingDirectory);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(statePath);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }

    try {
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumSnapshotBytes) {
        throw new Error("Claude Code hook state is not a bounded regular file");
      }
      if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
        throw new Error("Claude Code hook state is not private to its owner");
      }
      let value: unknown;
      try {
        value = JSON.parse(await readFile(statePath, "utf8")) as unknown;
      } catch {
        throw new Error("Claude Code hook state is invalid JSON");
      }
      if (!isCapturedIntent(value) || value.repositoryRoot !== repositoryRoot) {
        throw new Error("Claude Code hook state does not match this repository");
      }
      return { intent: value.intent, baseRef: value.baseRef };
    } finally {
      await unlink(statePath).catch(ignoreMissing);
    }
  }

  public async clear(sessionId: string, workingDirectory: string): Promise<void> {
    const { statePath } = await this.location(sessionId, workingDirectory);
    await unlink(statePath).catch(ignoreMissing);
  }

  private async location(
    sessionId: string,
    workingDirectory: string,
  ): Promise<{ statePath: string; repositoryRoot: string }> {
    const [rootOutput, gitDirectoryOutput] = await Promise.all([
      this.commands.run({
        executable: "git",
        arguments: ["rev-parse", "--show-toplevel"],
        cwd: workingDirectory,
      }),
      this.commands.run({
        executable: "git",
        arguments: ["rev-parse", "--absolute-git-dir"],
        cwd: workingDirectory,
      }),
    ]);
    const repositoryRoot = await realpath(rootOutput.trim());
    const gitDirectory = await realpath(gitDirectoryOutput.trim());
    const privateDirectory = join(gitDirectory, "intentpatch-hooks");
    await mkdir(privateDirectory, { mode: 0o700, recursive: true });
    const metadata = await lstat(privateDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Claude Code hook state directory is not a regular directory");
    }
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new Error("Claude Code hook state directory is not private to its owner");
    }

    const name = createHash("sha256").update(sessionId).digest("hex");
    return { statePath: join(privateDirectory, `${name}.json`), repositoryRoot };
  }
}

function isCapturedIntent(
  value: unknown,
): value is CapturedAgentIntent & { readonly repositoryRoot: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "repositoryRoot" in value &&
    typeof value.repositoryRoot === "string" &&
    "baseRef" in value &&
    typeof value.baseRef === "string" &&
    /^[0-9a-f]{40,64}$/u.test(value.baseRef) &&
    "intent" in value &&
    typeof value.intent === "string" &&
    value.intent.length > 0
  );
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function ignoreMissing(error: unknown): void {
  if (!isMissing(error)) throw error;
}
