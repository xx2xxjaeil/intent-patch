import { posix } from "node:path";
import {
  createImpactAnalysis,
  type ImpactAnalysis,
  type ImpactAnalysisIssue,
  type ImpactedFile,
  type ModuleDependency,
  type UnresolvedModuleReference,
} from "../../domain/impact.js";
import type { AnalysisContext } from "../ports/analysis-rule.js";
import type { ChangeImpactAnalyzer } from "../ports/change-impact-analyzer.js";
import type { ModuleAliasResolver } from "../ports/module-alias-resolver.js";
import type { ModuleReferenceExtractor } from "../ports/module-reference-extractor.js";
import type { ProjectFileSource, ProjectSnapshot } from "../ports/project-file-source.js";
import { isMaintainedSourcePath } from "./is-maintained-source-path.js";

const typeScriptSourceExtensions = [
  ".ts",
  ".tsx",
  ".d.ts",
  ".mts",
  ".d.mts",
  ".cts",
  ".d.cts",
] as const;
const emittedJavaScriptExtensions = [".js", ".jsx", ".mjs", ".cjs"] as const;
const sourceExtensions = [...typeScriptSourceExtensions, ...emittedJavaScriptExtensions] as const;

interface ImportGraph {
  readonly sourcePaths: readonly string[];
  readonly availablePaths: ReadonlySet<string>;
  readonly dependencies: readonly ModuleDependency[];
  readonly unresolvedReferences: readonly UnresolvedModuleReference[];
  readonly issues: readonly ImpactAnalysisIssue[];
}

/** 현재 그래프와 삭제 파일에 한한 이전 그래프에서 직접·간접 의존자를 찾는다. */
export class AnalyzeImportImpact implements ChangeImpactAnalyzer {
  public constructor(
    private readonly files: ProjectFileSource,
    private readonly extractors: readonly ModuleReferenceExtractor[],
    private readonly aliases: ModuleAliasResolver,
  ) {}

  public async analyze(context: AnalysisContext): Promise<ImpactAnalysis> {
    const current = await this.buildGraph(context, "current");
    const changedModules = context.changes.files
      .filter(
        (file) => isMaintainedSourcePath(file.path) && this.extractorFor(file.path) !== undefined,
      )
      .map((file) => file.path);
    const deletedModules = context.changes.files
      .filter(
        (file) =>
          file.kind === "deleted" &&
          isMaintainedSourcePath(file.path) &&
          this.extractorFor(file.path) !== undefined,
      )
      .map((file) => file.path);

    let impactedFiles = calculateImpactedFiles(changedModules, current.dependencies);
    const issues = [...current.issues];
    if (deletedModules.length > 0) {
      const previous = await this.buildGraph(context, "base");
      const historical = calculateImpactedFiles(deletedModules, previous.dependencies);
      impactedFiles = mergeHistoricalImpact(impactedFiles, historical, current.availablePaths);
      issues.push(
        ...previous.issues.map((issue) => ({
          path: issue.path,
          reason: `Previous snapshot: ${issue.reason}`,
        })),
      );
    }

    return createImpactAnalysis({
      sourceFiles: current.sourcePaths.length,
      changedModules,
      dependencies: current.dependencies,
      impactedFiles,
      unresolvedReferences: current.unresolvedReferences,
      issues,
    });
  }

  private async buildGraph(
    context: AnalysisContext,
    snapshot: ProjectSnapshot,
  ): Promise<ImportGraph> {
    const allPaths = await this.files.listPaths(context.target, snapshot);
    const sourcePaths = allPaths.filter(
      (path) => isMaintainedSourcePath(path) && this.extractorFor(path) !== undefined,
    );
    const sources = new Map<string, string>();
    const issues: ImpactAnalysisIssue[] = [];

    // Git ls-files는 working tree에서 삭제한 tracked 파일도 열거하므로 읽힌 파일만 해석에 사용한다.
    for (const path of sourcePaths) {
      const file = await this.files.read(context.target, path, snapshot);
      if (file.kind === "success") sources.set(path, file.content);
      if (file.kind === "unavailable") issues.push({ path, reason: file.reason });
    }

    const availablePaths = new Set(sources.keys());
    const aliasResolver = await this.aliases.prepare(
      context.target,
      allPaths,
      availablePaths,
      snapshot,
    );
    const dependencies: ModuleDependency[] = [];
    const unresolvedReferences: UnresolvedModuleReference[] = [];
    issues.push(...aliasResolver.issues);

    for (const [path, source] of sources) {
      const extractor = this.extractorFor(path);
      if (extractor === undefined) {
        continue;
      }
      const references = extractor.extract(path, source);
      if (references.kind === "unavailable") {
        issues.push({ path, reason: references.reason });
        continue;
      }

      for (const specifier of references.specifiers) {
        const relative = isRelativeSpecifier(specifier);
        const imported = relative
          ? resolveRelativeModule(path, specifier, availablePaths)
          : aliasResolver.resolve(path, specifier);
        if (imported === undefined) {
          if (relative) {
            unresolvedReferences.push({ importer: path, specifier });
          }
        } else {
          dependencies.push({ importer: path, imported });
        }
      }
    }

    return {
      sourcePaths: [...sources.keys()],
      availablePaths,
      dependencies,
      unresolvedReferences,
      issues,
    };
  }

  private extractorFor(path: string): ModuleReferenceExtractor | undefined {
    return this.extractors.find((extractor) => extractor.supports(path));
  }
}

function mergeHistoricalImpact(
  current: readonly ImpactedFile[],
  historical: readonly ImpactedFile[],
  availablePaths: ReadonlySet<string>,
): ImpactedFile[] {
  const byPath = new Map(current.map((file) => [file.path, file]));
  for (const file of historical) {
    if (!availablePaths.has(file.path)) continue;
    const existing = byPath.get(file.path);
    byPath.set(
      file.path,
      existing === undefined
        ? { ...file, viaPreviousImports: true }
        : {
            ...existing,
            distance: Math.min(existing.distance, file.distance),
            changedModules: [...new Set([...existing.changedModules, ...file.changedModules])],
            viaPreviousImports: true,
          },
    );
  }
  return [...byPath.values()];
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

export function resolveRelativeModule(
  importer: string,
  specifier: string,
  availablePaths: ReadonlySet<string>,
): string | undefined {
  const basePath = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (basePath === ".." || basePath.startsWith("../") || posix.isAbsolute(basePath)) {
    return undefined;
  }

  for (const candidate of moduleCandidates(basePath, importer)) {
    if (availablePaths.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function moduleCandidates(basePath: string, importer: string): string[] {
  const candidates = [basePath];
  const emittedExtension = emittedJavaScriptExtensions.find((extension) =>
    basePath.endsWith(extension),
  );

  if (emittedExtension !== undefined) {
    const stem = basePath.slice(0, -emittedExtension.length);
    const generatedExtensions =
      emittedExtension === ".mjs"
        ? [".mts", ".d.mts"]
        : emittedExtension === ".cjs"
          ? [".cts", ".d.cts"]
          : [".ts", ".tsx", ".d.ts"];
    candidates.push(...generatedExtensions.map((extension) => `${stem}${extension}`));
    return candidates;
  }

  if (posix.extname(basePath).length === 0) {
    // 확장자가 없는 JS import는 같은 이름의 TS 파일보다 실행 가능한 JS 파일을 우선한다.
    const extensions = /\.(?:[cm]?js|jsx)$/u.test(importer)
      ? [...emittedJavaScriptExtensions, ...typeScriptSourceExtensions]
      : sourceExtensions;
    candidates.push(...extensions.map((extension) => `${basePath}${extension}`));
    candidates.push(...extensions.map((extension) => posix.join(basePath, `index${extension}`)));
  }

  return candidates;
}

function calculateImpactedFiles(
  changedModules: readonly string[],
  dependencies: readonly ModuleDependency[],
): ImpactedFile[] {
  const changed = new Set(changedModules);
  const importersByModule = new Map<string, Set<string>>();
  const impacts = new Map<string, { distance: number; changedModules: Set<string> }>();

  for (const dependency of dependencies) {
    const importers = importersByModule.get(dependency.imported) ?? new Set<string>();
    importers.add(dependency.importer);
    importersByModule.set(dependency.imported, importers);
  }

  for (const root of changed) {
    const queue: Array<{ path: string; distance: number }> = [{ path: root, distance: 0 }];
    const visited = new Set([root]);

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (current === undefined) {
        continue;
      }
      for (const importer of importersByModule.get(current.path) ?? []) {
        if (visited.has(importer)) {
          continue;
        }
        visited.add(importer);
        const distance = current.distance + 1;
        queue.push({ path: importer, distance });

        if (changed.has(importer)) {
          continue;
        }
        const existing = impacts.get(importer);
        if (existing === undefined) {
          impacts.set(importer, { distance, changedModules: new Set([root]) });
        } else {
          existing.distance = Math.min(existing.distance, distance);
          existing.changedModules.add(root);
        }
      }
    }
  }

  return [...impacts].map(([path, impact]) => ({
    path,
    distance: impact.distance,
    changedModules: [...impact.changedModules],
  }));
}
