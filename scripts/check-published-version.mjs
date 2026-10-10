import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function runNpm(args) {
  return execFileSync("npm", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isMissingVersion(error) {
  return (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    error.status === 1 &&
    "stderr" in error &&
    /\bE404\b/.test(String(error.stderr))
  );
}

/**
 * 이미 공개된 버전이라면 동일한 tarball인지 확인해 잘못된 GitHub Release를 막는다.
 */
export function assertMatchingIntegrity(packageId, localIntegrity, publishedIntegrity) {
  if (localIntegrity !== publishedIntegrity) {
    throw new Error(
      `${packageId} already exists on npm with a different tarball. Refusing to create a GitHub Release.`,
    );
  }
}

function main() {
  const { name, version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const packageId = `${name}@${version}`;

  let publishedIntegrity;
  try {
    publishedIntegrity = JSON.parse(
      runNpm(["view", packageId, "dist.integrity", "--json", "--loglevel=error"]),
    );
  } catch (error) {
    if (!isMissingVersion(error)) {
      throw error;
    }

    process.stdout.write("already_published=false\n");
    return;
  }

  const [localPackage] = JSON.parse(
    runNpm(["pack", "--dry-run", "--json", "--ignore-scripts", "--silent"]),
  );
  assertMatchingIntegrity(packageId, localPackage?.integrity, publishedIntegrity);
  process.stdout.write("already_published=true\n");
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
