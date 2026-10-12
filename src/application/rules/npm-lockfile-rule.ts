import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";
import type { LockedPackage, PackageLockParser } from "../ports/package-lock-parser.js";

const lockfilePath = "package-lock.json";

/** 선언 버전이 아닌, npm이 실제로 고정한 패키지 버전과 설치 위치의 변화를 분석한다. */
export class NpmLockfileRule implements AnalysisRule {
  public constructor(
    private readonly snapshots: FileSnapshotSource,
    private readonly parser: PackageLockParser,
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
    if (before?.ok && after?.ok) {
      return comparePackages(before.packages, after.packages);
    }
    return [];
  }
}

function comparePackages(
  before: ReadonlyMap<string, LockedPackage>,
  after: ReadonlyMap<string, LockedPackage>,
): Finding[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const findings: Finding[] = [];
  for (const path of paths) {
    const previous = before.get(path);
    const current = after.get(path);
    if (previous === undefined && current !== undefined) {
      findings.push({
        ruleId: "dependency/locked-package-added",
        severity: "low",
        title: "Resolved package added",
        description: `${current.name}@${current.version} was added at ${path}.`,
        file: lockfilePath,
        evidence: packageEvidence(current),
      });
    } else if (previous !== undefined && current === undefined) {
      findings.push({
        ruleId: "dependency/locked-package-removed",
        severity: "low",
        title: "Resolved package removed",
        description: `${previous.name}@${previous.version} was removed from ${path}.`,
        file: lockfilePath,
        evidence: packageEvidence(previous),
      });
    } else if (
      previous !== undefined &&
      current !== undefined &&
      previous.version !== current.version
    ) {
      findings.push({
        ruleId: "dependency/locked-version-changed",
        severity: "low",
        title: "Resolved package version changed",
        description: `${current.name} at ${path} changed from ${previous.version} to ${current.version}.`,
        file: lockfilePath,
        evidence: { ...packageEvidence(current), from: previous.version, to: current.version },
      });
    }
  }
  return findings;
}

function packageEvidence(item: LockedPackage): Finding["evidence"] {
  return {
    package: item.name,
    version: item.version,
    installPath: item.path,
    rootDirect: item.rootDirect,
  };
}

function parseFinding(
  side: "base" | "current",
  result: Extract<ReturnType<PackageLockParser["parse"]>, { ok: false }>,
): Finding {
  const unsupported = result.kind === "unsupported";
  return {
    ruleId: unsupported ? "dependency/unsupported-lockfile" : "dependency/invalid-lockfile",
    severity: unsupported ? "low" : "high",
    title: unsupported ? "Unsupported npm lockfile" : "Invalid npm lockfile",
    description: `Could not analyze the ${side} package-lock.json: ${result.reason}`,
    file: lockfilePath,
    evidence: { side, reason: result.reason },
  };
}

function lockfilePresenceFinding(kind: "added" | "removed", packageCount: number): Finding {
  return {
    ruleId: `dependency/lockfile-${kind}`,
    severity: "low",
    title: kind === "added" ? "npm lockfile added" : "npm lockfile removed",
    description: `package-lock.json was ${kind} with ${packageCount} resolved packages.`,
    file: lockfilePath,
    evidence: { packageCount },
  };
}
