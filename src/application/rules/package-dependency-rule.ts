import type { Finding, Severity } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";

const manifestPath = "package.json";
const dependencySections = ["dependencies", "devDependencies"] as const;

type DependencySection = (typeof dependencySections)[number];

interface DependencyDeclaration {
  readonly section: DependencySection;
  readonly version: string;
}

type ManifestParseResult =
  | Readonly<{ ok: true; dependencies: ReadonlyMap<string, DependencyDeclaration> }>
  | Readonly<{ ok: false; finding: Finding }>;

/**
 * 루트 package.json의 직접 dependency 변경만 판단한다.
 * lockfile의 전이 dependency와 workspace package 지원은 별도 규칙으로 확장한다.
 */
export class PackageDependencyRule implements AnalysisRule {
  public constructor(private readonly snapshots: FileSnapshotSource) {}

  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    if (!context.changes.files.some(isManifestChange)) {
      return [];
    }

    const snapshot = await this.snapshots.read(context.target, manifestPath);
    const before = parseManifest(snapshot.before, "base");
    const after = parseManifest(snapshot.after, "current");
    if (!before.ok && !after.ok) {
      return [before.finding, after.finding];
    }
    if (!before.ok) {
      return [before.finding];
    }
    if (!after.ok) {
      return [after.finding];
    }

    return compareDependencies(before.dependencies, after.dependencies);
  }
}

function isManifestChange(change: AnalysisContext["changes"]["files"][number]): boolean {
  return change.path === manifestPath || change.previousPath === manifestPath;
}

function parseManifest(content: string | undefined, side: "base" | "current"): ManifestParseResult {
  if (content === undefined) {
    return { ok: true, dependencies: new Map() };
  }

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return invalidManifest(side, "The file is not valid JSON.");
  }

  if (!isRecord(value)) {
    return invalidManifest(side, "The root value must be a JSON object.");
  }

  const dependencies = new Map<string, DependencyDeclaration>();
  for (const section of dependencySections) {
    const entries = value[section];
    if (entries === undefined) {
      continue;
    }
    if (!isRecord(entries)) {
      return invalidManifest(side, `${section} must be a JSON object.`);
    }

    for (const [name, version] of Object.entries(entries)) {
      if (typeof version !== "string") {
        return invalidManifest(side, `${section}.${name} must have a string version.`);
      }
      if (dependencies.has(name)) {
        return invalidManifest(side, `${name} is declared in more than one dependency section.`);
      }
      dependencies.set(name, { section, version });
    }
  }

  return { ok: true, dependencies };
}

function compareDependencies(
  before: ReadonlyMap<string, DependencyDeclaration>,
  after: ReadonlyMap<string, DependencyDeclaration>,
): Finding[] {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort((left, right) =>
    left.localeCompare(right),
  );
  const findings: Finding[] = [];

  for (const name of names) {
    const previous = before.get(name);
    const current = after.get(name);

    if (previous === undefined && current !== undefined) {
      findings.push(addedDependency(name, current));
      continue;
    }
    if (previous !== undefined && current === undefined) {
      findings.push(removedDependency(name, previous));
      continue;
    }
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (previous.section !== current.section) {
      findings.push(movedDependency(name, previous, current));
      continue;
    }
    if (previous.version !== current.version) {
      findings.push(changedDependency(name, previous, current));
    }
  }

  return findings;
}

function addedDependency(name: string, declaration: DependencyDeclaration): Finding {
  const production = declaration.section === "dependencies";
  return {
    ruleId: production ? "dependency/new-production" : "dependency/new-development",
    severity: production ? "medium" : "low",
    title: production ? "New production dependency" : "New development dependency",
    description: `${name}@${declaration.version} was added to ${declaration.section}.`,
    file: manifestPath,
    evidence: {
      package: name,
      version: declaration.version,
      section: declaration.section,
    },
  };
}

function removedDependency(name: string, declaration: DependencyDeclaration): Finding {
  return {
    ruleId: "dependency/removed",
    severity: "low",
    title: "Dependency removed",
    description: `${name}@${declaration.version} was removed from ${declaration.section}.`,
    file: manifestPath,
    evidence: {
      package: name,
      version: declaration.version,
      section: declaration.section,
    },
  };
}

function movedDependency(
  name: string,
  previous: DependencyDeclaration,
  current: DependencyDeclaration,
): Finding {
  return {
    ruleId: "dependency/section-changed",
    severity: current.section === "dependencies" ? "medium" : "low",
    title: "Dependency section changed",
    description: `${name} moved from ${previous.section} to ${current.section}.`,
    file: manifestPath,
    evidence: {
      package: name,
      from: previous.section,
      to: current.section,
      version: current.version,
    },
  };
}

function changedDependency(
  name: string,
  previous: DependencyDeclaration,
  current: DependencyDeclaration,
): Finding {
  return {
    ruleId: "dependency/version-changed",
    severity: severityFor(current.section),
    title: "Dependency version changed",
    description: `${name} changed from ${previous.version} to ${current.version}.`,
    file: manifestPath,
    evidence: {
      package: name,
      from: previous.version,
      to: current.version,
      section: current.section,
    },
  };
}

function invalidManifest(side: "base" | "current", reason: string): ManifestParseResult {
  return {
    ok: false,
    finding: {
      ruleId: "dependency/invalid-manifest",
      severity: "high",
      title: "Invalid package manifest",
      description: `Could not analyze the ${side} package.json: ${reason}`,
      file: manifestPath,
      evidence: { side, reason },
    },
  };
}

function severityFor(section: DependencySection): Severity {
  return section === "dependencies" ? "medium" : "low";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
