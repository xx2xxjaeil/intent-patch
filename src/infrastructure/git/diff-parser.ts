import type { FileChange, FileChangeKind, LineDelta } from "../../domain/change.js";

interface NameStatusEntry {
  readonly path: string;
  readonly previousPath?: string;
  readonly kind: FileChangeKind;
}

interface NumStatEntry {
  readonly path: string;
  readonly previousPath?: string;
  readonly lines: LineDelta;
}

export function parseGitDiff(nameStatusOutput: string, numStatOutput: string): FileChange[] {
  // 파일 상태와 라인 통계는 서로 다른 Git 출력에서 얻으므로 최종 경로를 키로 병합한다.
  const statuses = parseNameStatus(nameStatusOutput);
  const stats = parseNumStat(numStatOutput);
  const statsByPath = new Map(stats.map((entry) => [entry.path, entry]));
  const changes: FileChange[] = [];

  for (const status of statuses) {
    const stat = statsByPath.get(status.path);
    const previousPath = status.previousPath ?? stat?.previousPath;
    const common = {
      path: status.path,
      kind: status.kind,
      lines:
        stat?.lines ??
        ({ kind: "unavailable", reason: "Git did not provide line statistics." } as const),
    };

    changes.push(previousPath === undefined ? common : { ...common, previousPath });
    statsByPath.delete(status.path);
  }

  for (const stat of statsByPath.values()) {
    const common = {
      path: stat.path,
      kind: "unknown" as const,
      lines: stat.lines,
    };
    changes.push(
      stat.previousPath === undefined ? common : { ...common, previousPath: stat.previousPath },
    );
  }

  return changes;
}

function parseNameStatus(output: string): NameStatusEntry[] {
  const tokens = splitNullTerminated(output);
  const entries: NameStatusEntry[] = [];

  // -z 출력은 상태와 경로를 NUL로 구분한다. 따라서 공백, 탭, 개행이 포함된 경로도 안전하다.
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index];
    if (status === undefined) {
      break;
    }

    const firstPath = tokens[index + 1];
    if (firstPath === undefined) {
      throw new Error(`Missing path after Git status: ${status}`);
    }

    const isMove = status.startsWith("R") || status.startsWith("C");
    if (isMove) {
      const path = tokens[index + 2];
      if (path === undefined) {
        throw new Error(`Missing destination path after Git status: ${status}`);
      }
      entries.push({ path, previousPath: firstPath, kind: mapStatus(status) });
      index += 3;
      continue;
    }

    entries.push({ path: firstPath, kind: mapStatus(status) });
    index += 2;
  }

  return entries;
}

function parseNumStat(output: string): NumStatEntry[] {
  const tokens = splitNullTerminated(output);
  const entries: NumStatEntry[] = [];

  for (let index = 0; index < tokens.length; ) {
    const record = tokens[index];
    if (record === undefined) {
      break;
    }

    const [additionsToken, deletionsToken, inlinePath] = record.split("\t");
    if (additionsToken === undefined || deletionsToken === undefined || inlinePath === undefined) {
      throw new Error(`Malformed Git numstat record: ${record}`);
    }

    const lines = parseLineDelta(additionsToken, deletionsToken);

    if (inlinePath.length > 0) {
      entries.push({ path: inlinePath, lines });
      index += 1;
      continue;
    }

    // rename/copy 레코드는 세 번째 필드가 비어 있고 이전·현재 경로가 다음 NUL 토큰에 온다.
    const previousPath = tokens[index + 1];
    const path = tokens[index + 2];
    if (previousPath === undefined || path === undefined) {
      throw new Error("Malformed Git rename numstat record.");
    }
    entries.push({ path, previousPath, lines });
    index += 3;
  }

  return entries;
}

function parseLineDelta(additions: string, deletions: string): LineDelta {
  if (additions === "-" || deletions === "-") {
    return { kind: "binary" };
  }

  const additionsCount = Number.parseInt(additions, 10);
  const deletionsCount = Number.parseInt(deletions, 10);
  if (!Number.isSafeInteger(additionsCount) || !Number.isSafeInteger(deletionsCount)) {
    throw new Error(`Invalid Git line statistics: ${additions}/${deletions}`);
  }

  return { kind: "measured", additions: additionsCount, deletions: deletionsCount };
}

function mapStatus(status: string): FileChangeKind {
  switch (status[0]) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}

function splitNullTerminated(output: string): string[] {
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") {
    tokens.pop();
  }
  return tokens;
}
