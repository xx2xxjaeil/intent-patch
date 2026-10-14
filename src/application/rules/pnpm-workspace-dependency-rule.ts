import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";
import type {
  PnpmWorkspaceParseResult,
  PnpmWorkspaceParser,
} from "../ports/pnpm-workspace-parser.js";
import {
  analyzeWorkspaceManifests,
  isNestedManifestChange,
} from "../services/workspace-manifest-analysis.js";

const configPath = "pnpm-workspace.yaml";

/** pnpm-workspace.yaml의 package glob으로 변경 manifest를 찾아 직접 dependency를 비교한다. */
export class PnpmWorkspaceDependencyRule implements AnalysisRule {
  public constructor(
    private readonly snapshots: FileSnapshotSource,
    private readonly parser: PnpmWorkspaceParser,
  ) {}

  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    const manifests = context.changes.files.filter(isNestedManifestChange);
    const configChanged = context.changes.files.some(
      (change) => change.path === configPath || change.previousPath === configPath,
    );
    if (manifests.length === 0 && !configChanged) return [];

    const snapshot = await this.snapshots.read(context.target, configPath);
    if (snapshot.before === undefined && snapshot.after === undefined) return [];
    const before = this.parser.parse(snapshot.before);
    const after = this.parser.parse(snapshot.after);
    const errors = [
      ...(!before.ok ? [configFinding("base", before)] : []),
      ...(!after.ok ? [configFinding("current", after)] : []),
    ];
    if (errors.length > 0 || !before.ok || !after.ok) return errors;

    const findings: Finding[] = [];
    if (configChanged && JSON.stringify(before.patterns) !== JSON.stringify(after.patterns)) {
      findings.push({
        ruleId: "dependency/pnpm-workspace-config-changed",
        severity: "low",
        title: "pnpm workspace configuration changed",
        description: "The pnpm-workspace.yaml package patterns changed.",
        file: configPath,
        evidence: { from: JSON.stringify(before.patterns), to: JSON.stringify(after.patterns) },
      });
    }
    return [
      ...findings,
      ...(await analyzeWorkspaceManifests(
        context,
        this.snapshots,
        manifests,
        before.patterns,
        after.patterns,
        "pnpm",
      )),
    ];
  }
}

function configFinding(
  side: "base" | "current",
  result: Extract<PnpmWorkspaceParseResult, { ok: false }>,
): Finding {
  const invalidConfig = result.kind === "invalid";
  return {
    ruleId: invalidConfig
      ? "dependency/invalid-pnpm-workspace-config"
      : "dependency/unsupported-pnpm-workspace-pattern",
    severity: invalidConfig ? "high" : "low",
    title: invalidConfig
      ? "Invalid pnpm workspace configuration"
      : "Unsupported pnpm workspace pattern",
    description: `Could not analyze the ${side} pnpm workspace: ${result.reason}`,
    file: configPath,
    evidence: { side, reason: result.reason },
  };
}
