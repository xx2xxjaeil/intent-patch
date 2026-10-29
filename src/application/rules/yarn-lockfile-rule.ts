import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";
import type { YarnLockedPackage, YarnLockParser } from "../ports/yarn-lock-parser.js";

const lockfilePath = "yarn.lock";

/** Yarn 4가 고정한 레지스트리 패키지의 추가·제거·단일 버전 교체를 보고한다. */
export class YarnLockfileRule implements AnalysisRule {
  public constructor(
    private readonly snapshots: FileSnapshotSource,
    private readonly parser: YarnLockParser,
  ) {}

  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    if (
      !context.changes.files.some(
        (file) => file.path === lockfilePath || file.previousPath === lockfilePath,
      )
    )
      return [];
    const snapshot = await this.snapshots.read(context.target, lockfilePath);
    const before = snapshot.before === undefined ? undefined : this.parser.parse(snapshot.before);
    const after = snapshot.after === undefined ? undefined : this.parser.parse(snapshot.after);
    const errors = [
      ...(before !== undefined && !before.ok ? [parseFinding("base", before)] : []),
      ...(after !== undefined && !after.ok ? [parseFinding("current", after)] : []),
    ];
    if (errors.length > 0) return errors;
    if (before === undefined && after?.ok) return [presenceFinding("added", after.packages.size)];
    if (after === undefined && before?.ok)
      return [presenceFinding("removed", before.packages.size)];
    if (!before?.ok || !after?.ok) return [];

    const findings: Finding[] = [];
    const beforeByName = groupByName(before.packages);
    const afterByName = groupByName(after.packages);
    const names = [...new Set([...beforeByName.keys(), ...afterByName.keys()])].sort();
    for (const name of names) {
      const removed = (beforeByName.get(name) ?? []).filter((item) => !after.packages.has(item.id));
      const added = (afterByName.get(name) ?? []).filter((item) => !before.packages.has(item.id));
      if (
        removed.length === 1 &&
        added.length === 1 &&
        removed[0] !== undefined &&
        added[0] !== undefined
      ) {
        findings.push({
          ruleId: "dependency/locked-version-changed",
          severity: "low",
          title: "Resolved package version changed",
          description: `${name} changed from ${removed[0].version} to ${added[0].version} in yarn.lock.`,
          file: lockfilePath,
          evidence: { ...evidence(added[0]), from: removed[0].version, to: added[0].version },
        });
      } else {
        findings.push(
          ...added.map((item) => packageFinding("added", item)),
          ...removed.map((item) => packageFinding("removed", item)),
        );
      }
    }
    return findings;
  }
}

function groupByName(
  packages: ReadonlyMap<string, YarnLockedPackage>,
): Map<string, YarnLockedPackage[]> {
  const grouped = new Map<string, YarnLockedPackage[]>();
  for (const item of packages.values()) {
    const group = grouped.get(item.name) ?? [];
    group.push(item);
    grouped.set(item.name, group);
  }
  return grouped;
}

function evidence(item: YarnLockedPackage): Finding["evidence"] {
  return {
    package: item.name,
    version: item.version,
    packageId: item.id,
    rootDirect: item.rootDirect,
    packageManager: "yarn",
  };
}

function packageFinding(kind: "added" | "removed", item: YarnLockedPackage): Finding {
  return {
    ruleId: `dependency/locked-package-${kind}`,
    severity: "low",
    title: kind === "added" ? "Resolved package added" : "Resolved package removed",
    description: `${item.id} was ${kind} in yarn.lock.`,
    file: lockfilePath,
    evidence: evidence(item),
  };
}

function parseFinding(
  side: "base" | "current",
  result: Extract<ReturnType<YarnLockParser["parse"]>, { ok: false }>,
): Finding {
  const unsupported = result.kind === "unsupported";
  return {
    ruleId: unsupported
      ? "dependency/unsupported-yarn-lockfile"
      : "dependency/invalid-yarn-lockfile",
    severity: unsupported ? "low" : "high",
    title: unsupported ? "Unsupported Yarn lockfile" : "Invalid Yarn lockfile",
    description: `Could not analyze the ${side} yarn.lock: ${result.reason}`,
    file: lockfilePath,
    evidence: { side, reason: result.reason },
  };
}

function presenceFinding(kind: "added" | "removed", packageCount: number): Finding {
  return {
    ruleId: `dependency/yarn-lockfile-${kind}`,
    severity: "low",
    title: kind === "added" ? "Yarn lockfile added" : "Yarn lockfile removed",
    description: `yarn.lock was ${kind} with ${packageCount} resolved registry packages.`,
    file: lockfilePath,
    evidence: { packageCount },
  };
}
