import { parseDocument } from "yaml";
import { invalidParseResult as invalid } from "../../application/ports/parse-failure.js";
import type {
  YarnLockedPackage,
  YarnLockParseResult,
  YarnLockParser,
} from "../../application/ports/yarn-lock-parser.js";
import { isRecord } from "../../domain/value-guards.js";

const registryResolution =
  /^((?:@[^/@]+\/)?[^/@]+)@npm:(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/u;
const directSections = ["dependencies", "devDependencies", "optionalDependencies"] as const;

/** Yarn 4의 metadata v8 YAML lockfile만 읽는다. Classic/다른 버전은 추측하지 않는다. */
export class YarnYamlLockParser implements YarnLockParser {
  public parse(content: string): YarnLockParseResult {
    try {
      const document = parseDocument(content, { logLevel: "error", stringKeys: true });
      if (document.errors.length > 0) {
        return invalid(
          `The file is not valid YAML: ${document.errors[0]?.message ?? "unknown error"}`,
        );
      }
      const value: unknown = document.toJS({ maxAliasCount: 100 });
      if (!isRecord(value) || !isRecord(value.__metadata)) {
        return invalid("A Yarn lockfile must contain a __metadata mapping.");
      }
      if (String(value.__metadata.version) !== "8") {
        return {
          ok: false,
          kind: "unsupported",
          reason: `Only Yarn 4 lockfile metadata version 8 is supported; found ${String(value.__metadata.version)}.`,
        };
      }

      const direct = rootDependencies(value);
      if (!direct.ok) return direct;
      const packages = new Map<string, YarnLockedPackage>();
      for (const [descriptor, entry] of Object.entries(value)) {
        if (descriptor === "__metadata") continue;
        if (
          !isRecord(entry) ||
          typeof entry.resolution !== "string" ||
          typeof entry.version !== "string"
        ) {
          return invalid(
            `Lockfile entry ${JSON.stringify(descriptor)} must contain resolution and version strings.`,
          );
        }
        const match = registryResolution.exec(entry.resolution);
        if (match === null) continue; // workspace:, patch:, file:, virtual: 등은 레지스트리 버전이 아니다.
        const [, name, version] = match;
        if (name === undefined || version === undefined || entry.version !== version) {
          return invalid(
            `Lockfile entry ${JSON.stringify(descriptor)} has inconsistent version and resolution.`,
          );
        }
        packages.set(entry.resolution, {
          id: entry.resolution,
          name,
          version,
          rootDirect: direct.names.has(name),
        });
      }
      return { ok: true, packages };
    } catch (error) {
      return invalid(
        `The YAML parser could not read the lockfile: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function rootDependencies(
  lockfile: Record<string, unknown>,
):
  | Readonly<{ ok: true; names: ReadonlySet<string> }>
  | Extract<YarnLockParseResult, { ok: false }> {
  const names = new Set<string>();
  for (const entry of Object.values(lockfile)) {
    if (
      !isRecord(entry) ||
      typeof entry.resolution !== "string" ||
      !entry.resolution.endsWith("@workspace:.")
    )
      continue;
    for (const section of directSections) {
      const dependencies = entry[section];
      if (dependencies === undefined) continue;
      if (!isRecord(dependencies))
        return invalid(`Root workspace ${section} must be a YAML mapping.`);
      for (const name of Object.keys(dependencies)) names.add(name);
    }
  }
  return { ok: true, names };
}
