import { parseAllDocuments } from "yaml";
import { invalidParseResult as invalid } from "../../application/ports/parse-failure.js";
import type {
  PnpmLockedPackage,
  PnpmLockParseResult,
  PnpmLockParser,
} from "../../application/ports/pnpm-lock-parser.js";
import { isRecord } from "../../domain/value-guards.js";

const directSections = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const packageNamePattern = /^(?:@[^/@]+\/)?[^/@]+$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
type PnpmLockError = Extract<PnpmLockParseResult, { ok: false }>;

/** pnpm v9의 프로젝트 문서만 읽는다. 앞의 환경 문서를 프로젝트 dependency로 합치지 않는다. */
export class PnpmYamlLockParser implements PnpmLockParser {
  public parse(content: string): PnpmLockParseResult {
    try {
      const documents = parseAllDocuments(content, { logLevel: "error", stringKeys: true });
      if (documents.length === 0) {
        return invalid("The file does not contain a YAML document.");
      }
      if (documents.length > 2) {
        return unsupported(
          "Expected one project document, optionally preceded by one environment document.",
        );
      }
      const values: Record<string, unknown>[] = [];
      for (const document of documents) {
        if (document.errors.length > 0) {
          return invalid(
            `The file is not valid YAML: ${document.errors[0]?.message ?? "unknown error"}`,
          );
        }
        const value: unknown = document.toJS({ maxAliasCount: 100 });
        if (!isRecord(value)) {
          return invalid("Each lockfile document must be a YAML mapping.");
        }
        values.push(value);
        const version = validateVersion(value.lockfileVersion);
        if (version !== undefined) {
          return version;
        }
      }

      const project = values.at(-1);
      if (project === undefined || !isRecord(project.importers)) {
        return invalid("The project document must contain an importers mapping.");
      }
      if (project.packages !== undefined && !isRecord(project.packages)) {
        return invalid("packages must be a YAML mapping.");
      }

      const direct = parseRootDirectPackages(project.importers);
      if (!direct.ok) {
        return direct;
      }
      const packages = new Map<string, PnpmLockedPackage>();
      for (const [id, descriptor] of Object.entries(project.packages ?? {})) {
        if (!isRecord(descriptor)) {
          return invalid(`packages[${JSON.stringify(id)}] must be a YAML mapping.`);
        }
        const packageId = parseRegistryPackageId(id);
        if (packageId === undefined) {
          // file:, link:, Git 등 레지스트리 버전으로 표현할 수 없는 항목은 제외한다.
          continue;
        }
        packages.set(id, {
          id,
          ...packageId,
          rootDirect: direct.ids.has(id),
        });
      }
      return { ok: true, packages };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return invalid(`The YAML parser could not read the lockfile: ${reason}`);
    }
  }
}

function validateVersion(value: unknown): PnpmLockError | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return invalid("lockfileVersion must be a string or number.");
  }
  if (!/^9(?:\.\d+)?$/.test(String(value))) {
    return unsupported(`Only pnpm lockfile version 9 is supported; found ${String(value)}.`);
  }
  return undefined;
}

function parseRootDirectPackages(
  importers: Record<string, unknown>,
): Readonly<{ ok: true; ids: ReadonlySet<string> }> | PnpmLockError {
  const root = importers["."];
  if (root === undefined) {
    return { ok: true, ids: new Set() };
  }
  if (!isRecord(root)) {
    return invalid('importers["."] must be a YAML mapping.');
  }
  const ids = new Set<string>();
  for (const section of directSections) {
    const dependencies = root[section];
    if (dependencies === undefined) {
      continue;
    }
    if (!isRecord(dependencies)) {
      return invalid(`importers["."].${section} must be a YAML mapping.`);
    }
    for (const [name, descriptor] of Object.entries(dependencies)) {
      if (!isRecord(descriptor) || typeof descriptor.version !== "string") {
        return invalid(
          `importers["."].${section}[${JSON.stringify(name)}].version must be a string.`,
        );
      }
      const resolvedVersion = descriptor.version.split("(", 1)[0];
      if (
        packageNamePattern.test(name) &&
        resolvedVersion !== undefined &&
        versionPattern.test(resolvedVersion)
      ) {
        ids.add(`${name}@${resolvedVersion}`);
      }
    }
  }
  return { ok: true, ids };
}

function parseRegistryPackageId(id: string): { name: string; version: string } | undefined {
  const separator = id.lastIndexOf("@");
  if (separator <= 0) {
    return undefined;
  }
  const name = id.slice(0, separator);
  const version = id.slice(separator + 1);
  return packageNamePattern.test(name) && versionPattern.test(version)
    ? { name, version }
    : undefined;
}

function unsupported(reason: string): PnpmLockError {
  return { ok: false, kind: "unsupported", reason };
}
