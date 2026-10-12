import type { FileChange } from "../../domain/change.js";
import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";
import { matchesPathPattern } from "../services/path-pattern.js";
import { PackageDependencyRule } from "./package-dependency-rule.js";

const rootManifestPath = "package.json";
const manifestSuffix = "/package.json";

type WorkspaceConfigResult =
  | Readonly<{ ok: true; patterns: readonly string[] }>
  | Readonly<{ ok: false; kind: "invalid" | "unsupported"; reason: string }>;

/** npm workspaces에 속한 변경 manifest를 찾아 기존 직접 dependency 규칙으로 분석한다. */
export class NpmWorkspaceDependencyRule implements AnalysisRule {
  public constructor(private readonly snapshots: FileSnapshotSource) {}

  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    const manifestChanges = context.changes.files.filter(isNestedManifestChange);
    const rootChanged = context.changes.files.some(
      (change) => change.path === rootManifestPath || change.previousPath === rootManifestPath,
    );
    if (manifestChanges.length === 0 && !rootChanged) {
      return [];
    }

    const snapshot = await this.snapshots.read(context.target, rootManifestPath);
    const before = parseWorkspaceConfig(snapshot.before);
    const after = parseWorkspaceConfig(snapshot.after);
    const errors = [
      ...(!before.ok ? [configFinding("base", before)] : []),
      ...(!after.ok ? [configFinding("current", after)] : []),
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
        ruleId: "dependency/workspace-config-changed",
        severity: "low",
        title: "npm workspace configuration changed",
        description: "The root package.json workspace patterns changed.",
        file: rootManifestPath,
        evidence: {
          from: JSON.stringify(before.patterns),
          to: JSON.stringify(after.patterns),
        },
      });
    }

    const results = await Promise.all(
      manifestChanges.map(async (change) => {
        const previousPath =
          change.kind === "renamed" ? (change.previousPath ?? change.path) : change.path;
        const currentPath = change.path;
        const wasWorkspace =
          change.kind !== "added" &&
          change.kind !== "copied" &&
          isConfiguredWorkspace(previousPath, before.patterns);
        const isWorkspace =
          change.kind !== "deleted" && isConfiguredWorkspace(currentPath, after.patterns);
        if (!wasWorkspace && !isWorkspace) {
          return [];
        }

        const manifestPath = isNestedManifestPath(currentPath) ? currentPath : previousPath;
        const workspacePath = manifestPath.slice(0, -manifestSuffix.length);
        const membershipFinding: Finding[] =
          change.kind === "renamed" && wasWorkspace !== isWorkspace
            ? [
                {
                  ruleId: "dependency/workspace-membership-changed",
                  severity: "low",
                  title: "npm workspace membership changed",
                  description: `${previousPath} moved to ${currentPath}, changing workspace membership.`,
                  file: currentPath,
                  evidence: {
                    previousPath,
                    currentPath,
                    fromWorkspace: wasWorkspace,
                    toWorkspace: isWorkspace,
                  },
                },
              ]
            : [];
        const dependencyFindings = await new PackageDependencyRule(
          this.snapshots,
          manifestPath,
        ).analyze(context);
        return [
          ...membershipFinding,
          ...dependencyFindings.map((finding) => ({
            ...finding,
            evidence: { ...finding.evidence, workspace: workspacePath },
          })),
        ];
      }),
    );
    return [...findings, ...results.flat()];
  }
}

function isNestedManifestChange(change: FileChange): boolean {
  return isNestedManifestPath(change.path) || isNestedManifestPath(change.previousPath);
}

function isNestedManifestPath(path: string | undefined): path is string {
  return path?.endsWith(manifestSuffix) === true;
}

function isConfiguredWorkspace(path: string, patterns: readonly string[]): boolean {
  if (!isNestedManifestPath(path)) {
    return false;
  }
  const directory = path.slice(0, -manifestSuffix.length);
  return patterns.some((pattern) => matchesPathPattern(directory, pattern));
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
  if (manifest.workspaces === undefined) {
    return { ok: true, patterns: [] };
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
  return { ok: true, patterns };
}

function configFinding(
  side: "base" | "current",
  result: Extract<WorkspaceConfigResult, { ok: false }>,
): Finding {
  return {
    ruleId:
      result.kind === "invalid"
        ? "dependency/invalid-workspace-config"
        : "dependency/unsupported-workspace-pattern",
    severity: result.kind === "invalid" ? "high" : "low",
    title:
      result.kind === "invalid"
        ? "Invalid npm workspace configuration"
        : "Unsupported npm workspace pattern",
    description: `Could not analyze the ${side} npm workspaces: ${result.reason}`,
    file: rootManifestPath,
    evidence: { side, reason: result.reason },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
