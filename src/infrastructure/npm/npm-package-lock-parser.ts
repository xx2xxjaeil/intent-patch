import type {
  LockedPackage,
  PackageLockParseResult,
  PackageLockParser,
} from "../../application/ports/package-lock-parser.js";

const directDependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** npm v7+의 packages 맵을 설치 위치별 사실로 변환한다. v2의 레거시 dependencies 맵은 중복 집계하지 않는다. */
export class NpmPackageLockParser implements PackageLockParser {
  public parse(content: string): PackageLockParseResult {
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      return invalid("The file is not valid JSON.");
    }

    if (!isRecord(value)) {
      return invalid("The root value must be a JSON object.");
    }
    if (typeof value.lockfileVersion !== "number" || !Number.isInteger(value.lockfileVersion)) {
      return invalid("lockfileVersion must be an integer.");
    }
    if (value.lockfileVersion !== 2 && value.lockfileVersion !== 3) {
      return {
        ok: false,
        kind: "unsupported",
        reason: `Supported lockfile versions are 2 and 3; found ${value.lockfileVersion}.`,
      };
    }
    if (!isRecord(value.packages)) {
      return invalid("packages must be a JSON object.");
    }

    const root = value.packages[""];
    if (root !== undefined && !isRecord(root)) {
      return invalid('packages[""] must be a JSON object.');
    }
    const rootDirect = new Set<string>();
    if (root !== undefined) {
      for (const section of directDependencySections) {
        const declarations = root[section];
        if (declarations === undefined) {
          continue;
        }
        if (!isRecord(declarations)) {
          return invalid(`packages[""].${section} must be a JSON object.`);
        }
        for (const name of Object.keys(declarations)) {
          rootDirect.add(name);
        }
      }
    }

    const packages = new Map<string, LockedPackage>();
    for (const [path, descriptor] of Object.entries(value.packages)) {
      const name = packageNameAt(path);
      if (name === undefined) {
        continue;
      }
      if (!isRecord(descriptor)) {
        return invalid(`packages[${JSON.stringify(path)}] must be a JSON object.`);
      }
      // npm workspaces and local links are represented as symlinks, not resolved external packages.
      if (descriptor.link === true) {
        continue;
      }
      if (typeof descriptor.version !== "string" || descriptor.version.length === 0) {
        return invalid(`packages[${JSON.stringify(path)}].version must be a non-empty string.`);
      }
      packages.set(path, {
        path,
        name,
        version: descriptor.version,
        rootDirect: path === `node_modules/${name}` && rootDirect.has(name),
      });
    }

    return { ok: true, packages };
  }
}

function packageNameAt(path: string): string | undefined {
  const marker = "node_modules/";
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex === -1 || (markerIndex > 0 && path[markerIndex - 1] !== "/")) {
    return undefined;
  }
  const name = path.slice(markerIndex + marker.length);
  return /^(?:@[^/]+\/)?[^/]+$/.test(name) ? name : undefined;
}

function invalid(reason: string): PackageLockParseResult {
  return { ok: false, kind: "invalid", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
