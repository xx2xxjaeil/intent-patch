import type { ChangeSource } from "../../application/ports/change-source.js";
import { type ChangeSet, createChangeSet, type FileChange } from "../../domain/change.js";
import type { AnalysisTarget } from "../../domain/report.js";
import { type CommandRunner, NodeCommandRunner } from "../process/command-runner.js";
import { parseGitDiff } from "./diff-parser.js";
import { collectUntrackedFiles } from "./untracked-file-collector.js";

/** Git CLI 출력을 도메인 모델로 변환하는 ChangeSource 어댑터다. */
export class GitChangeSource implements ChangeSource {
  public constructor(
    private readonly workingDirectory: string,
    private readonly commandRunner: CommandRunner = new NodeCommandRunner(),
  ) {}

  public async collect(target: AnalysisTarget): Promise<ChangeSet> {
    const repositoryRoot = (
      await this.commandRunner.run({
        executable: "git",
        arguments: ["rev-parse", "--show-toplevel"],
        cwd: this.workingDirectory,
      })
    ).trim();

    const [nameStatus, numStat] = await Promise.all([
      this.runDiff(repositoryRoot, target, "--name-status"),
      this.runDiff(repositoryRoot, target, "--numstat"),
    ]);

    const changes = parseGitDiff(nameStatus, numStat);
    const allChanges =
      target.headRef === undefined
        ? mergeTrackedAndUntracked(
            changes,
            await collectUntrackedFiles(repositoryRoot, this.commandRunner),
          )
        : changes;

    return createChangeSet(allChanges);
  }

  private runDiff(
    repositoryRoot: string,
    target: AnalysisTarget,
    outputFormat: "--name-status" | "--numstat",
  ): Promise<string> {
    // 두 ref 비교에서는 PR과 같은 의미가 되도록 공통 조상 이후의 변경만 가져온다.
    const range =
      target.headRef === undefined ? target.baseRef : `${target.baseRef}...${target.headRef}`;

    return this.commandRunner.run({
      executable: "git",
      arguments: ["diff", outputFormat, "--find-renames=50%", "-z", range, "--"],
      cwd: repositoryRoot,
    });
  }
}

function mergeTrackedAndUntracked(
  tracked: readonly FileChange[],
  untracked: readonly FileChange[],
): FileChange[] {
  const trackedPaths = new Set(tracked.map((change) => change.path));
  return [...tracked, ...untracked.filter((change) => !trackedPaths.has(change.path))];
}
