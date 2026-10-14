import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";
import type { PnpmLockedPackage, PnpmLockParser } from "../ports/pnpm-lock-parser.js";

const lockfilePath = "pnpm-lock.yaml";

/** pnpm의 프로젝트 lockfile에서 고정된 레지스트리 패키지 버전 변화를 보고한다. */
export class PnpmLockfileRule implements AnalysisRule {
  public constructor(
    private readonly snapshots: FileSnapshotSource,
    private readonly parser: PnpmLockParser,
  ) {}

  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    if (
      !context.changes.files.some(
        (change) => change.path === lockfilePath || change.previousPath === lockfilePath,
      )
    ) {
      return [];
    }

    const snapshot = await this.snapshots.read(context.target, lockfilePath);
    const before = snapshot.before === undefined ? undefined : this.parser.parse(snapshot.before);
    const after = snapshot.after === undefined ? undefined : this.parser.parse(snapshot.after);
    const errors = [
      ...(before !== undefined && !before.ok ? [parseFinding("base", before)] : []),
      ...(after !== undefined && !after.ok ? [parseFinding("current", after)] : []),
    ];
    if (errors.length > 0) {
      return errors;
    }
    if (before === undefined && after === undefined) {
      return [];
    }
    if (before === undefined && after?.ok) {
      return [lockfilePresenceFinding("added", after.packages.size)];
    }
    if (after === undefined && before?.ok) {
      return [lockfilePresenceFinding("removed", before.packages.size)];
    }
    return before?.ok && after?.ok ? comparePackages(before.packages, after.packages) : [];
  }
}

function comparePackages(
  before: ReadonlyMap<string, PnpmLockedPackage>,
  after: ReadonlyMap<string, PnpmLockedPackage>,
): Finding[] {
  const beforeByName = groupByName(before);
  const afterByName = groupByName(after);
  const names = [...new Set([...beforeByName.keys(), ...afterByName.keys()])].sort();
  const findings: Finding[] = [];

  for (const name of names) {
    const removed = (beforeByName.get(name) ?? [])
      .filter((item) => !after.has(item.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    const added = (afterByName.get(name) ?? [])
      .filter((item) => !before.has(item.id))
      .sort((left, right) => left.id.localeCompare(right.id));

    // 단일 교체만 버전 변경으로 연결한다. 여러 버전이 동시에 이동하면 짝을 추측하지 않는다.
    if (removed.length === 1 && added.length === 1) {
      const previous = removed[0];
      const current = added[0];
      if (previous !== undefined && current !== undefined) {
        findings.push({
          ruleId: "dependency/locked-version-changed",
          severity: "low",
          title: "Resolved package version changed",
          description: `${name} changed from ${previous.version} to ${current.version} in pnpm-lock.yaml.`,
          file: lockfilePath,
          evidence: { ...packageEvidence(current), from: previous.version, to: current.version },
        });
        continue;
      }
    }
    findings.push(...added.map((item) => packageFinding("added", item)));
    findings.push(...removed.map((item) => packageFinding("removed", item)));
  }
  return findings;
}

function groupByName(
  packages: ReadonlyMap<string, PnpmLockedPackage>,
): Map<string, PnpmLockedPackage[]> {
  const groups = new Map<string, PnpmLockedPackage[]>();
  for (const item of packages.values()) {
    const group = groups.get(item.name) ?? [];
    group.push(item);
    groups.set(item.name, group);
  }
  return groups;
}

function packageFinding(kind: "added" | "removed", item: PnpmLockedPackage): Finding {
  return {
    ruleId: `dependency/locked-package-${kind}`,
    severity: "low",
    title: kind === "added" ? "Resolved package added" : "Resolved package removed",
    description: `${item.id} was ${kind} in pnpm-lock.yaml.`,
    file: lockfilePath,
    evidence: packageEvidence(item),
  };
}

function packageEvidence(item: PnpmLockedPackage): Finding["evidence"] {
  return {
    package: item.name,
    version: item.version,
    packageId: item.id,
    rootDirect: item.rootDirect,
  };
}

function parseFinding(
  side: "base" | "current",
  result: Extract<ReturnType<PnpmLockParser["parse"]>, { ok: false }>,
): Finding {
  const unsupported = result.kind === "unsupported";
  return {
    ruleId: unsupported
      ? "dependency/unsupported-pnpm-lockfile"
      : "dependency/invalid-pnpm-lockfile",
    severity: unsupported ? "low" : "high",
    title: unsupported ? "Unsupported pnpm lockfile" : "Invalid pnpm lockfile",
    description: `Could not analyze the ${side} pnpm-lock.yaml: ${result.reason}`,
    file: lockfilePath,
    evidence: { side, reason: result.reason },
  };
}

function lockfilePresenceFinding(kind: "added" | "removed", packageCount: number): Finding {
  return {
    ruleId: `dependency/pnpm-lockfile-${kind}`,
    severity: "low",
    title: kind === "added" ? "pnpm lockfile added" : "pnpm lockfile removed",
    description: `pnpm-lock.yaml was ${kind} with ${packageCount} resolved registry packages.`,
    file: lockfilePath,
    evidence: { packageCount },
  };
}
