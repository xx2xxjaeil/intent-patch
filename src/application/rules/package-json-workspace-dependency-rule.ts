import type { Finding } from "../../domain/finding.js";
import { isRecord } from "../../domain/value-guards.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";
import {
  analyzeWorkspaceManifests,
  isNestedManifestChange,
} from "../services/workspace-manifest-analysis.js";

const rootManifestPath = "package.json";

type WorkspaceConfigResult =
  | Readonly<{ ok: true; patterns: readonly string[]; managerHint?: "npm" | "yarn" }>
  | Readonly<{ ok: false; kind: "invalid" | "unsupported"; reason: string }>;

/** package.json workspaces를 npm 또는 Yarn 소유로 분류해 직접 dependency를 비교한다. */
export class PackageJsonWorkspaceDependencyRule implements AnalysisRule {
  public constructor(private readonly snapshots: FileSnapshotSource) {}

  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    const manifestChanges = context.changes.files.filter(isNestedManifestChange);
    const rootChanged = context.changes.files.some(
      (change) => change.path === rootManifestPath || change.previousPath === rootManifestPath,
    );
    if (manifestChanges.length === 0 && !rootChanged) {
      return [];
    }

    // pnpm 설정이 있으면 별도 규칙이 담당한다. Yarn lockfile이 있으면 Yarn으로 귀속한다.
    const pnpmConfig = await this.snapshots.read(context.target, "pnpm-workspace.yaml");
    if (pnpmConfig.before !== undefined || pnpmConfig.after !== undefined) return [];

    const snapshot = await this.snapshots.read(context.target, rootManifestPath);
    const before = parseWorkspaceConfig(snapshot.before);
    const after = parseWorkspaceConfig(snapshot.after);
    const yarnLock = await this.snapshots.read(context.target, "yarn.lock");
    const manager =
      (after.ok ? after.managerHint : undefined) ??
      (before.ok ? before.managerHint : undefined) ??
      (yarnLock.before !== undefined || yarnLock.after !== undefined ? "yarn" : "npm");
    const errors = [
      ...(!before.ok ? [configFinding("base", before, manager)] : []),
      ...(!after.ok ? [configFinding("current", after, manager)] : []),
    ];
    if (errors.length > 0) {
      return errors;
    }
    if (!before.ok || !after.ok) {
      return [];
    }

    const findings: Finding[] = [];
    if (rootChanged && JSON.stringify(before.patterns) !== JSON.stringify(after.patterns)) {
      findings.push({
        ruleId:
          manager === "yarn"
            ? "dependency/yarn-workspace-config-changed"
            : "dependency/workspace-config-changed",
        severity: "low",
        title: `${manager} workspace configuration changed`,
        description: "The root package.json workspace patterns changed.",
        file: rootManifestPath,
        evidence: {
          from: JSON.stringify(before.patterns),
          to: JSON.stringify(after.patterns),
          ...(manager === "yarn" ? { packageManager: manager } : {}),
        },
      });
    }

    return [
      ...findings,
      ...(await analyzeWorkspaceManifests(
        context,
        this.snapshots,
        manifestChanges,
        { includes: before.patterns, excludes: [] },
        { includes: after.patterns, excludes: [] },
        manager,
      )),
    ];
  }
}

function parseWorkspaceConfig(content: string | undefined): WorkspaceConfigResult {
  if (content === undefined) {
    return { ok: true, patterns: [] };
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch {
    return { ok: false, kind: "invalid", reason: "The root package.json is not valid JSON." };
  }
  if (!isRecord(manifest)) {
    return { ok: false, kind: "invalid", reason: "The root package.json must be an object." };
  }
  const managerHint =
    typeof manifest.packageManager === "string" && manifest.packageManager.startsWith("yarn@")
      ? "yarn"
      : typeof manifest.packageManager === "string" && manifest.packageManager.startsWith("npm@")
        ? "npm"
        : undefined;
  if (manifest.workspaces === undefined) {
    return { ok: true, patterns: [], ...(managerHint === undefined ? {} : { managerHint }) };
  }
  if (!Array.isArray(manifest.workspaces)) {
    return { ok: false, kind: "invalid", reason: "workspaces must be an array of paths." };
  }

  const patterns: string[] = [];
  for (const rawPattern of manifest.workspaces) {
    if (typeof rawPattern !== "string" || rawPattern.trim().length === 0) {
      return { ok: false, kind: "invalid", reason: "Each workspace path must be a string." };
    }
    const pattern = rawPattern.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
    if (pattern.length === 0 || pattern.startsWith("/") || pattern.split("/").includes("..")) {
      return { ok: false, kind: "invalid", reason: `Invalid workspace path: ${rawPattern}.` };
    }
    if (["!", "{", "}", "[", "]", "\\"].some((character) => pattern.includes(character))) {
      return {
        ok: false,
        kind: "unsupported",
        reason: `Unsupported workspace pattern: ${rawPattern}. Only *, **, and ? globs are supported.`,
      };
    }
    patterns.push(pattern);
  }
  return { ok: true, patterns, ...(managerHint === undefined ? {} : { managerHint }) };
}

function configFinding(
  side: "base" | "current",
  result: Extract<WorkspaceConfigResult, { ok: false }>,
  manager: "npm" | "yarn",
): Finding {
  return {
    ruleId:
      result.kind === "invalid"
        ? "dependency/invalid-workspace-config"
        : "dependency/unsupported-workspace-pattern",
    severity: result.kind === "invalid" ? "high" : "low",
    title:
      result.kind === "invalid"
        ? `Invalid ${manager} workspace configuration`
        : `Unsupported ${manager} workspace pattern`,
    description: `Could not analyze the ${side} ${manager} workspaces: ${result.reason}`,
    file: rootManifestPath,
    evidence: {
      side,
      reason: result.reason,
      ...(manager === "yarn" ? { packageManager: manager } : {}),
    },
  };
}
