import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const packageJsonUrl = new URL("../package.json", import.meta.url);

/**
 * Git tag와 package.json 버전이 서로 다른 상태로 배포되는 것을 막는다.
 */
export function assertReleaseTag(tag, version) {
  const expectedTag = `v${version}`;

  if (tag !== expectedTag) {
    throw new Error(`Release tag must be ${expectedTag}, but received ${tag || "<empty>"}.`);
  }
}

async function main() {
  const packageMetadata = JSON.parse(await readFile(packageJsonUrl, "utf8"));
  const version = packageMetadata.version;

  if (typeof version !== "string" || version.length === 0) {
    throw new Error("package.json must contain a non-empty version.");
  }

  const tag = process.env.GITHUB_REF_NAME ?? process.argv[2] ?? "";
  assertReleaseTag(tag, version);
  process.stdout.write(`Release tag ${tag} matches package version ${version}.\n`);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
