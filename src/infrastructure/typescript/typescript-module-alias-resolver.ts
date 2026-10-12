import { posix } from "node:path";
import ts from "typescript";
import type {
  ModuleAliasResolver,
  PreparedModuleAliasResolver,
} from "../../application/ports/module-alias-resolver.js";
import type { ProjectFileSource } from "../../application/ports/project-file-source.js";
import type { AnalysisTarget } from "../../domain/report.js";
import {
  TypeScriptConfigLoader,
  virtualProjectPath,
  virtualProjectRoot,
} from "./typescript-config-loader.js";

/** 가장 가까운 tsconfig/jsconfig의 paths·baseUrl을 Git snapshot 안에서 해석한다. */
export class TypeScriptModuleAliasResolver implements ModuleAliasResolver {
  public constructor(private readonly files: ProjectFileSource) {}

  public async prepare(
    target: AnalysisTarget,
    repositoryPaths: readonly string[],
    sourcePaths: ReadonlySet<string>,
  ): Promise<PreparedModuleAliasResolver> {
    const configPaths = new Set(repositoryPaths.filter(isProjectConfig));
    const configByImporter = new Map<string, string>();
    for (const importer of sourcePaths) {
      const configPath = nearestConfig(importer, configPaths);
      if (configPath !== undefined) {
        configByImporter.set(importer, configPath);
      }
    }

    const loaded = await new TypeScriptConfigLoader(this.files).load(
      target,
      repositoryPaths,
      [...new Set(configByImporter.values())].sort(),
    );
    const virtualSources = new Set([...sourcePaths].map(virtualProjectPath));
    const directories = sourceDirectories(virtualSources);
    const host: ts.ModuleResolutionHost = {
      fileExists: (path) => virtualSources.has(path),
      readFile: () => undefined,
      directoryExists: (path) => directories.has(path),
      getCurrentDirectory: () => virtualProjectRoot,
      realpath: (path) => path,
      useCaseSensitiveFileNames: true,
    };

    return {
      issues: loaded.issues,
      resolve: (importer, specifier) => {
        const configPath = configByImporter.get(importer);
        const options = configPath === undefined ? undefined : loaded.optionsByPath.get(configPath);
        if (
          options === undefined ||
          (options.paths === undefined && options.baseUrl === undefined)
        ) {
          return undefined;
        }

        const resolved = ts.resolveModuleName(
          specifier,
          virtualProjectPath(importer),
          options,
          host,
        ).resolvedModule?.resolvedFileName;
        if (resolved === undefined) {
          return undefined;
        }

        const path = posix.relative(virtualProjectRoot, resolved);
        return sourcePaths.has(path) ? path : undefined;
      },
    };
  }
}

function isProjectConfig(path: string): boolean {
  return posix.basename(path) === "tsconfig.json" || posix.basename(path) === "jsconfig.json";
}

function nearestConfig(importer: string, configPaths: ReadonlySet<string>): string | undefined {
  let directory = posix.dirname(importer);
  while (true) {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const candidate = directory === "." ? name : posix.join(directory, name);
      if (configPaths.has(candidate)) {
        return candidate;
      }
    }
    if (directory === ".") {
      return undefined;
    }
    directory = posix.dirname(directory);
  }
}

function sourceDirectories(virtualSources: ReadonlySet<string>): ReadonlySet<string> {
  const directories = new Set([virtualProjectRoot]);
  for (const source of virtualSources) {
    let directory = posix.dirname(source);
    while (!directories.has(directory)) {
      directories.add(directory);
      directory = posix.dirname(directory);
    }
  }
  return directories;
}
