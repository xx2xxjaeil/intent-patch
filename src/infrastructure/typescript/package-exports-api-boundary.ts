import { posix } from "node:path";
import ts from "typescript";
import type { ProjectFileSource } from "../../application/ports/project-file-source.js";
import type { PublicApiBoundary } from "../../application/ports/public-api-boundary.js";
import { resolveRelativeModule } from "../../application/services/analyze-import-impact.js";
import { isMaintainedSourcePath } from "../../application/services/is-maintained-source-path.js";
import type { AnalysisTarget } from "../../domain/report.js";
import { parseTypeScriptSource } from "./parse-typescript-source.js";

/** 이전 package.json의 exports에서 소스 진입점과 re-export 경로를 추적한다. */
export class PackageExportsApiBoundary implements PublicApiBoundary {
  public constructor(private readonly files: ProjectFileSource) {}

  public async internalPaths(
    target: AnalysisTarget,
    changedPaths: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const allPaths = await this.files.listPaths(target, "base");
    const availablePaths = new Set(allPaths);
    const manifests = allPaths.filter((path) => posix.basename(path) === "package.json");
    const packages = new Map<string, Promise<ReadonlySet<string> | undefined>>();
    const internal = new Set<string>();

    for (const path of changedPaths) {
      const manifest = nearestManifest(path, manifests);
      if (manifest === undefined) continue;
      let exposed = packages.get(manifest);
      if (exposed === undefined) {
        exposed = this.exposedPaths(target, manifest, availablePaths);
        packages.set(manifest, exposed);
      }
      const paths = await exposed;
      if (paths !== undefined && !paths.has(path)) internal.add(path);
    }
    return internal;
  }

  private async exposedPaths(
    target: AnalysisTarget,
    manifestPath: string,
    availablePaths: ReadonlySet<string>,
  ): Promise<ReadonlySet<string> | undefined> {
    const manifest = await this.files.read(target, manifestPath, "base");
    if (manifest.kind !== "success") return undefined;

    let metadata: unknown;
    try {
      metadata = JSON.parse(manifest.content);
    } catch {
      return undefined;
    }
    if (!isRecord(metadata) || !("exports" in metadata)) return undefined;
    const targets = collectTargets(metadata.exports);
    if (targets === undefined) return undefined;

    const packageRoot = posix.dirname(manifestPath);
    const entries = new Set<string>();
    for (const destination of targets) {
      const resolved = resolveTarget(manifestPath, packageRoot, destination, availablePaths);
      if (resolved === undefined || resolved.some((path) => !isMaintainedSourcePath(path))) {
        // 생성된 dist만 보이는 경우 소스의 공개 여부를 증명할 수 없다.
        return undefined;
      }
      for (const path of resolved) entries.add(path);
    }

    const exposed = new Set(entries);
    const queue = [...entries];
    for (let index = 0; index < queue.length; index += 1) {
      const path = queue[index];
      if (path === undefined) continue;
      const source = await this.files.read(target, path, "base");
      if (source.kind !== "success") return undefined;
      const parsed = parseTypeScriptSource(path, source.content);
      if (parsed.kind === "unavailable") return undefined;
      const reExports = reExportSpecifiers(parsed.sourceFile);
      if (reExports === undefined) return undefined;
      for (const specifier of reExports) {
        if (!isRelativeSpecifier(specifier)) continue;
        const imported = resolveRelativeModule(path, specifier, availablePaths);
        if (imported === undefined || !withinPackage(imported, packageRoot)) return undefined;
        if (!exposed.has(imported)) {
          exposed.add(imported);
          queue.push(imported);
        }
      }
    }
    return exposed;
  }
}

function reExportSpecifiers(sourceFile: ts.SourceFile): readonly string[] | undefined {
  const importedNames = new Map<string, string>();
  const specifiers = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.name !== undefined)
        importedNames.set(clause.name.text, statement.moduleSpecifier.text);
      if (clause?.namedBindings !== undefined) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          importedNames.set(clause.namedBindings.name.text, statement.moduleSpecifier.text);
        } else {
          for (const element of clause.namedBindings.elements) {
            importedNames.set(element.name.text, statement.moduleSpecifier.text);
          }
        }
      }
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      const expression = statement.moduleReference.expression;
      if (expression !== undefined && ts.isStringLiteralLike(expression)) {
        importedNames.set(statement.name.text, expression.text);
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier !== undefined) {
        if (!ts.isStringLiteralLike(statement.moduleSpecifier)) return undefined;
        specifiers.add(statement.moduleSpecifier.text);
      } else if (
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) {
          const imported = importedNames.get((element.propertyName ?? element.name).text);
          if (imported !== undefined) specifiers.add(imported);
        }
      }
    }
    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) return undefined;
      if (ts.isIdentifier(statement.expression)) {
        const imported = importedNames.get(statement.expression.text);
        if (imported !== undefined) specifiers.add(imported);
      } else {
        return undefined;
      }
    }
  }

  if (/\b(?:module\s*\.\s*exports|exports\s*\.|require\s*\()/u.test(sourceFile.text)) {
    return undefined;
  }
  return [...specifiers];
}

function nearestManifest(path: string, manifests: readonly string[]): string | undefined {
  let directory = posix.dirname(path);
  while (true) {
    const manifest = posix.join(directory, "package.json");
    if (manifests.includes(manifest)) return manifest;
    if (directory === ".") return undefined;
    directory = posix.dirname(directory);
  }
}

function collectTargets(value: unknown): readonly string[] | undefined {
  if (value === null) return [];
  if (typeof value === "string") return value.startsWith("./") ? [value] : undefined;
  if (Array.isArray(value)) {
    const targets = value.map(collectTargets);
    return targets.some((item) => item === undefined)
      ? undefined
      : targets.flatMap((item) => item ?? []);
  }
  if (!isRecord(value)) return undefined;
  const targets = Object.values(value).map(collectTargets);
  return targets.some((item) => item === undefined)
    ? undefined
    : targets.flatMap((item) => item ?? []);
}

function resolveTarget(
  manifestPath: string,
  packageRoot: string,
  destination: string,
  availablePaths: ReadonlySet<string>,
): readonly string[] | undefined {
  const path = posix.normalize(posix.join(packageRoot, destination));
  if (!withinPackage(path, packageRoot)) return undefined;
  if (!destination.includes("*")) {
    const resolved = resolveRelativeModule(manifestPath, destination, availablePaths);
    return resolved === undefined ? undefined : [resolved];
  }
  const pattern = new RegExp(`^${path.split("*").map(escapeRegExp).join(".*")}$`, "u");
  const matches = [...availablePaths].filter((candidate) => pattern.test(candidate));
  return matches.length === 0 ? undefined : matches;
}

function withinPackage(path: string, packageRoot: string): boolean {
  return packageRoot === "."
    ? path !== ".." && !path.startsWith("../") && !posix.isAbsolute(path)
    : path.startsWith(`${packageRoot}/`);
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
