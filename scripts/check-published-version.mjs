import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
 * 압축 형식이나 파일 순서가 달라도 실제 배포 파일이 같으면 같은 버전으로 취급한다.
 */
export function assertMatchingPackageFiles(
  packageId,
  localFiles,
  publishedFiles,
  localRoot,
  publishedRoot,
) {
  const localPaths = localFiles.map((file) => file.path).sort();
  const publishedPaths = publishedFiles.map((file) => file.path).sort();

  if (JSON.stringify(localPaths) !== JSON.stringify(publishedPaths)) {
    throw new Error(
      `${packageId} already exists on npm with different packaged files. Refusing to create a GitHub Release.`,
    );
  }

  const changedPaths = localPaths.filter(
    (path) => !readFileSync(join(localRoot, path)).equals(readFileSync(join(publishedRoot, path))),
  );
  if (changedPaths.length > 0) {
    throw new Error(
      `${packageId} already exists on npm with different file contents: ${changedPaths.slice(0, 5).join(", ")}. Refusing to create a GitHub Release.`,
    );
  }
}

export function assertMatchingPublishedFiles(packageId, localPackage, publishedIntegrity) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "intentpatch-published-"));

  try {
    const archiveDirectory = join(temporaryRoot, "archive");
    const extractedDirectory = join(temporaryRoot, "extracted");
    mkdirSync(archiveDirectory);
    mkdirSync(extractedDirectory);

    const [publishedPackage] = JSON.parse(
      runNpm([
        "pack",
        packageId,
        "--pack-destination",
        archiveDirectory,
        "--json",
        "--ignore-scripts",
        "--silent",
      ]),
    );
    if (publishedPackage?.integrity !== publishedIntegrity) {
      throw new Error(`${packageId} changed while checking its published contents.`);
    }

    execFileSync("tar", [
      "-xzf",
      join(archiveDirectory, basename(publishedPackage.filename)),
      "-C",
      extractedDirectory,
    ]);
    assertMatchingPackageFiles(
      packageId,
      localPackage.files,
      publishedPackage.files,
      projectRoot,
      join(extractedDirectory, "package"),
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
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
  if (localPackage?.integrity !== publishedIntegrity) {
    assertMatchingPublishedFiles(packageId, localPackage, publishedIntegrity);
    process.stderr.write(`${packageId}: tarball integrity differs, but packaged files match.\n`);
  }
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
