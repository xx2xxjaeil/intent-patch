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
import type { ModuleReferenceExtractor } from "../ports/module-reference-extractor.js";
import type { ProjectFileSource } from "../ports/project-file-source.js";

const sourceExtensions = [".ts", ".tsx", ".d.ts"] as const;
const emittedJavaScriptExtensions = [".js", ".jsx", ".mjs", ".cjs"] as const;

/** 현재 module graph를 역방향으로 탐색해 변경 파일의 직접·간접 의존자를 찾는다. */
export class AnalyzeImportImpact implements ChangeImpactAnalyzer {
  public constructor(
    private readonly files: ProjectFileSource,
    private readonly extractors: readonly ModuleReferenceExtractor[],
  ) {}

  public async analyze(context: AnalysisContext): Promise<ImpactAnalysis> {
    const allPaths = await this.files.listPaths(context.target);
    const sourcePaths = allPaths.filter((path) => this.extractorFor(path) !== undefined);
    const availablePaths = new Set(sourcePaths);
    const dependencies: ModuleDependency[] = [];
    const unresolvedReferences: UnresolvedModuleReference[] = [];
    const issues: ImpactAnalysisIssue[] = [];

    // 저장소 크기에 비례해 파일 핸들과 Git 프로세스가 폭증하지 않도록 순차 처리한다.
    for (const path of sourcePaths) {
      const extractor = this.extractorFor(path);
      if (extractor === undefined) {
        continue;
      }
      const file = await this.files.read(context.target, path);
      if (file.kind === "missing") {
        continue;
      }
      if (file.kind === "unavailable") {
        issues.push({ path, reason: file.reason });
        continue;
      }

      const references = extractor.extract(path, file.content);
      if (references.kind === "unavailable") {
        issues.push({ path, reason: references.reason });
        continue;
      }

      for (const specifier of references.specifiers) {
        if (!isRelativeSpecifier(specifier)) {
          continue;
        }
        const imported = resolveRelativeModule(path, specifier, availablePaths);
        if (imported === undefined) {
          unresolvedReferences.push({ importer: path, specifier });
        } else {
          dependencies.push({ importer: path, imported });
        }
      }
    }

    const changedModules = context.changes.files
      .filter((file) => this.extractorFor(file.path) !== undefined)
      .map((file) => file.path);
    const impactedFiles = calculateImpactedFiles(changedModules, dependencies);

    return createImpactAnalysis({
      sourceFiles: sourcePaths.length,
      changedModules,
      dependencies,
      impactedFiles,
      unresolvedReferences,
      issues,
    });
  }

  private extractorFor(path: string): ModuleReferenceExtractor | undefined {
    return this.extractors.find((extractor) => extractor.supports(path));
  }
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function resolveRelativeModule(
  importer: string,
  specifier: string,
  availablePaths: ReadonlySet<string>,
): string | undefined {
  const basePath = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (basePath === ".." || basePath.startsWith("../") || posix.isAbsolute(basePath)) {
    return undefined;
  }

  for (const candidate of moduleCandidates(basePath)) {
    if (availablePaths.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function moduleCandidates(basePath: string): string[] {
  const candidates = [basePath];
  const emittedExtension = emittedJavaScriptExtensions.find((extension) =>
    basePath.endsWith(extension),
  );

  if (emittedExtension !== undefined) {
    const stem = basePath.slice(0, -emittedExtension.length);
    candidates.push(...sourceExtensions.map((extension) => `${stem}${extension}`));
    return candidates;
  }

  if (posix.extname(basePath).length === 0) {
    candidates.push(...sourceExtensions.map((extension) => `${basePath}${extension}`));
    candidates.push(
      ...sourceExtensions.map((extension) => posix.join(basePath, `index${extension}`)),
    );
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
