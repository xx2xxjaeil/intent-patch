import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CommandRunner, NodeCommandRunner } from "../process/command-runner.js";

/** 민감한 요청문이 들어갈 수 있는 HTML을 작업 트리 밖의 Git 메타데이터에 보관한다. */
export class GitPrivateAgentReportWriter {
  public constructor(private readonly commands: CommandRunner = new NodeCommandRunner()) {}

  public async write(key: string, workingDirectory: string, content: string): Promise<string> {
    const gitDirectory = await realpath(
      (
        await this.commands.run({
          executable: "git",
          arguments: ["rev-parse", "--absolute-git-dir"],
          cwd: workingDirectory,
        })
      ).trim(),
    );
    const directory = join(gitDirectory, "intentpatch-reports");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Agent report directory is not a regular directory");
    }
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new Error("Agent report directory is not private to its owner");
    }

    const name = createHash("sha256").update(key).digest("hex");
    const destination = join(directory, `${name}.html`);
    const temporary = join(directory, `${name}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    }
    return destination;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
