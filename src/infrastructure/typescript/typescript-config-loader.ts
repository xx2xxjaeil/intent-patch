import { posix } from "node:path";
import ts from "typescript";
import type {
  ProjectFileSource,
  ProjectSnapshot,
} from "../../application/ports/project-file-source.js";
import type { ImpactAnalysisIssue } from "../../domain/impact.js";
import type { AnalysisTarget } from "../../domain/report.js";
import { isRecord } from "../../domain/value-guards.js";

export const virtualProjectRoot = "/__intentpatch_project__";

export function virtualProjectPath(path: string): string {
  return posix.join(virtualProjectRoot, path);
}

export interface LoadedTypeScriptConfigs {
  readonly optionsByPath: ReadonlyMap<string, ts.CompilerOptions>;
  readonly issues: readonly ImpactAnalysisIssue[];
}

/** Git snapshot의 설정만 사용해 TypeScript 경로 별칭을 읽는다. */
export class TypeScriptConfigLoader {
  public constructor(private readonly files: ProjectFileSource) {}

  public async load(
    target: AnalysisTarget,
    repositoryPaths: readonly string[],
    configPaths: readonly string[],
    snapshot: ProjectSnapshot = "current",
  ): Promise<LoadedTypeScriptConfigs> {
    const listedPaths = new Set(repositoryPaths);
    const configContents = new Map<string, string>();
    const parsedConfigs = new Map<string, Record<string, unknown>>();
    const visited = new Set<string>();
    const issues: ImpactAnalysisIssue[] = [];

    const collect = async (path: string): Promise<void> => {
      if (visited.has(path)) {
        return;
      }
      visited.add(path);

      const file = await this.files.read(target, path, snapshot);
      if (file.kind !== "success") {
        issues.push({
          path,
          reason: file.kind === "missing" ? "TypeScript config is missing" : file.reason,
        });
        return;
      }

      const parsed = ts.parseConfigFileTextToJson(path, file.content);
      if (parsed.error !== undefined || !isRecord(parsed.config)) {
        issues.push({
          path,
          reason:
            parsed.error === undefined
              ? "TypeScript config must be an object"
              : ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
        });
        return;
      }

      configContents.set(virtualProjectPath(path), file.content);
      parsedConfigs.set(path, parsed.config);
      const extensions = parsed.config.extends;
      const references = Array.isArray(extensions) ? extensions : [extensions];
      for (const reference of references) {
        if (typeof reference !== "string" || !reference.startsWith(".")) {
          continue;
        }
        const extendedPath = resolveExtendedConfig(path, reference, listedPaths);
        if (extendedPath !== undefined) {
          await collect(extendedPath);
        }
      }
    };

    for (const path of configPaths) {
      await collect(path);
    }

    const host: ts.ParseConfigHost = {
      useCaseSensitiveFileNames: true,
      readDirectory: () => [],
      fileExists: (path) => configContents.has(path),
      readFile: (path) => configContents.get(path),
    };
    const optionsByPath = new Map<string, ts.CompilerOptions>();

    for (const path of configPaths) {
      const config = parsedConfigs.get(path);
      if (config === undefined) {
        continue;
      }
      const parsed = ts.parseJsonConfigFileContent(
        config,
        host,
        posix.dirname(virtualProjectPath(path)),
        undefined,
        virtualProjectPath(path),
      );
      optionsByPath.set(path, parsed.options);
      for (const diagnostic of parsed.errors) {
        // 파일 목록은 사용하지 않으므로 빈 readDirectory에 따른 입력 없음 진단만 제외한다.
        if (diagnostic.code !== 18003) {
          issues.push({
            path,
            reason: ts
              .flattenDiagnosticMessageText(diagnostic.messageText, "\n")
              .replaceAll(`${virtualProjectRoot}/`, ""),
          });
        }
      }
    }

    return { optionsByPath, issues };
  }
}

function resolveExtendedConfig(
  configPath: string,
  reference: string,
  listedPaths: ReadonlySet<string>,
): string | undefined {
  const basePath = posix.normalize(posix.join(posix.dirname(configPath), reference));
  if (basePath === ".." || basePath.startsWith("../") || posix.isAbsolute(basePath)) {
    return undefined;
  }

  const candidates = [basePath, `${basePath}.json`, posix.join(basePath, "tsconfig.json")];
  return candidates.find((candidate) => listedPaths.has(candidate));
}
