import type { FileChange } from "../../domain/change.js";
import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";
import { PackageDependencyRule } from "../rules/package-dependency-rule.js";
import { matchesPathPattern } from "./path-pattern.js";

const manifestSuffix = "/package.json";

export interface WorkspacePatterns {
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
}

export function isNestedManifestChange(change: FileChange): boolean {
  return isNestedManifestPath(change.path) || isNestedManifestPath(change.previousPath);
}

/** 패키지 매니저별 설정 해석 뒤에는 같은 manifest 비교·membership 규칙을 적용한다. */
export async function analyzeWorkspaceManifests(
  context: AnalysisContext,
  snapshots: FileSnapshotSource,
  changes: readonly FileChange[],
  before: WorkspacePatterns,
  after: WorkspacePatterns,
  manager: "npm" | "pnpm" | "yarn",
): Promise<Finding[]> {
  const results = await Promise.all(
    changes.map(async (change) => {
      const previousPath =
        change.kind === "renamed" ? (change.previousPath ?? change.path) : change.path;
      const currentPath = change.path;
      const wasWorkspace =
        change.kind !== "added" && change.kind !== "copied" && isWorkspace(previousPath, before);
      const isCurrentWorkspace = change.kind !== "deleted" && isWorkspace(currentPath, after);
      if (!wasWorkspace && !isCurrentWorkspace) return [];

      const manifestPath = isNestedManifestPath(currentPath) ? currentPath : previousPath;
      const workspace = manifestPath.slice(0, -manifestSuffix.length);
      const membershipFinding: Finding[] =
        change.kind === "renamed" && wasWorkspace !== isCurrentWorkspace
          ? [
              {
                ruleId: "dependency/workspace-membership-changed",
                severity: "low",
                title: `${manager} workspace membership changed`,
                description: `${previousPath} moved to ${currentPath}, changing workspace membership.`,
                file: currentPath,
                evidence: {
                  previousPath,
                  currentPath,
                  fromWorkspace: wasWorkspace,
                  toWorkspace: isCurrentWorkspace,
                  ...(manager === "npm" ? {} : { packageManager: manager }),
                },
              },
            ]
          : [];
      const dependencies = await new PackageDependencyRule(snapshots, manifestPath).analyze(
        context,
      );
      return [
        ...membershipFinding,
        ...dependencies.map((finding) => ({
          ...finding,
          evidence: {
            ...finding.evidence,
            workspace,
            ...(manager === "npm" ? {} : { packageManager: manager }),
          },
        })),
      ];
    }),
  );
  return results.flat();
}

function isNestedManifestPath(path: string | undefined): path is string {
  return path?.endsWith(manifestSuffix) === true;
}

function isWorkspace(path: string, patterns: WorkspacePatterns): boolean {
  if (!isNestedManifestPath(path)) return false;
  const directory = path.slice(0, -manifestSuffix.length);
  return (
    patterns.includes.some((pattern) => matchesPathPattern(directory, pattern)) &&
    !patterns.excludes.some((pattern) => matchesPathPattern(directory, pattern))
  );
}
