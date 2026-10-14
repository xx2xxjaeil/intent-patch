import { parseAllDocuments } from "yaml";
import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";
import {
  analyzeWorkspaceManifests,
  isNestedManifestChange,
  type WorkspacePatterns,
} from "../services/workspace-manifest-analysis.js";

const configPath = "pnpm-workspace.yaml";
type ConfigResult =
  | Readonly<{ ok: true; patterns: WorkspacePatterns }>
  | Readonly<{ ok: false; kind: "invalid" | "unsupported"; reason: string }>;

/** pnpm-workspace.yaml의 package glob으로 변경 manifest를 찾아 직접 dependency를 비교한다. */
export class PnpmWorkspaceDependencyRule implements AnalysisRule {
  public constructor(private readonly snapshots: FileSnapshotSource) {}

  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    const manifests = context.changes.files.filter(isNestedManifestChange);
    const configChanged = context.changes.files.some(
      (change) => change.path === configPath || change.previousPath === configPath,
    );
    if (manifests.length === 0 && !configChanged) return [];

    const snapshot = await this.snapshots.read(context.target, configPath);
    if (snapshot.before === undefined && snapshot.after === undefined) return [];
    const before = parseConfig(snapshot.before);
    const after = parseConfig(snapshot.after);
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

function parseConfig(content: string | undefined): ConfigResult {
  if (content === undefined || content.trim().length === 0) {
    return { ok: true, patterns: { includes: [], excludes: [] } };
  }
  try {
    const documents = parseAllDocuments(content, { stringKeys: true, logLevel: "error" });
    if (documents.length !== 1 || documents[0] === undefined) {
      return invalid("Expected one YAML document.");
    }
    const document = documents[0];
    if (document.errors.length > 0) {
      return invalid(
        `The file is not valid YAML: ${document.errors[0]?.message ?? "unknown error"}`,
      );
    }
    const value: unknown = document.toJS({ maxAliasCount: 100 });
    if (!isRecord(value)) return invalid("The root value must be a YAML mapping.");
    if (value.packages === undefined) return { ok: true, patterns: { includes: [], excludes: [] } };
    if (!Array.isArray(value.packages)) return invalid("packages must be an array of paths.");

    const includes: string[] = [];
    const excludes: string[] = [];
    for (const raw of value.packages) {
      if (typeof raw !== "string" || raw.trim().length === 0) {
        return invalid("Each package path must be a non-empty string.");
      }
      const excluded = raw.startsWith("!");
      const pattern = raw
        .slice(excluded ? 1 : 0)
        .replace(/^(\.\/)+/u, "")
        .replace(/\/+$/u, "");
      if (pattern.length === 0 || pattern.startsWith("/") || pattern.split("/").includes("..")) {
        return invalid(`Invalid workspace path: ${raw}.`);
      }
      if (/[{}[\]\\!]/u.test(pattern)) {
        return {
          ok: false,
          kind: "unsupported",
          reason: `Unsupported workspace pattern: ${raw}. Only *, **, and ? globs are supported.`,
        };
      }
      (excluded ? excludes : includes).push(pattern);
    }
    return {
      ok: true,
      patterns: {
        includes: [...new Set(includes)].sort(),
        excludes: [...new Set(excludes)].sort(),
      },
    };
  } catch (error) {
    return invalid(
      `The YAML parser could not read the configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function configFinding(
  side: "base" | "current",
  result: Extract<ConfigResult, { ok: false }>,
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

function invalid(reason: string): ConfigResult {
  return { ok: false, kind: "invalid", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
