import type { FileChange } from "../../domain/change.js";
import type { AnalysisTarget, PatchPreview } from "../../domain/report.js";
import { type CommandRunner, NodeCommandRunner } from "../process/command-runner.js";

const maximumFiles = 30;
const maximumLinesPerFile = 160;

/** 규칙의 판정과 분리된, 크기 제한이 있는 검토용 diff를 수집한다. */
export class GitPatchPreviewSource {
  public constructor(
    private readonly workingDirectory: string,
    private readonly commandRunner: CommandRunner = new NodeCommandRunner(),
  ) {}

  public async collect(
    target: AnalysisTarget,
    files: readonly FileChange[],
  ): Promise<readonly PatchPreview[]> {
    const range =
      target.headRef === undefined ? target.baseRef : `${target.baseRef}...${target.headRef}`;
    const previews: PatchPreview[] = [];
    for (const file of files.slice(0, maximumFiles)) {
      if (file.lines.kind === "binary") {
        previews.push({
          path: file.path,
          lines: [],
          truncated: false,
          unavailableReason: "Binary file",
        });
        continue;
      }
      try {
        const paths = [file.previousPath, file.path]
          .filter((path): path is string => path !== undefined)
          .map((path) => `:(literal)${path}`);
        const patch = await this.commandRunner.run({
          executable: "git",
          arguments: [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--unified=3",
            range,
            "--",
            ...paths,
          ],
          cwd: this.workingDirectory,
        });
        const hunkLines = patch
          .split("\n")
          .filter(
            (line) =>
              (/^(?:@@|\+|-| )/u.test(line) || line.startsWith("\\ No newline")) &&
              !line.startsWith("+++") &&
              !line.startsWith("---"),
          );
        previews.push({
          path: file.path,
          lines: hunkLines.slice(0, maximumLinesPerFile),
          truncated: hunkLines.length > maximumLinesPerFile,
          ...(hunkLines.length === 0
            ? { unavailableReason: "No text patch (for example, an untracked file)" }
            : {}),
        });
      } catch {
        previews.push({
          path: file.path,
          lines: [],
          truncated: false,
          unavailableReason: "Git patch could not be read",
        });
      }
    }
    return previews;
  }
}
