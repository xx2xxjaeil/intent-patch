import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("packaged CLI integration", () => {
  it("installs the npm tarball and analyzes a Git working tree", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "intentpatch-package-test-"));
    temporaryDirectories.push(workspace);
    const repository = join(workspace, "consumer");
    await mkdir(join(repository, "src"), { recursive: true });
    await createRepository(repository);

    const { stdout: packedFileName } = await executeFile(
      "npm",
      ["pack", "--silent", "--pack-destination", workspace],
      { cwd: process.cwd() },
    );
    const tarball = join(workspace, packedFileName.trim());
    await executeFile(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-save",
        "--no-package-lock",
        "--offline",
        tarball,
      ],
      { cwd: repository },
    );

    const executable = join(
      repository,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "intentpatch.cmd" : "intentpatch",
    );
    const { version } = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { readonly version: string };
    const versionResult = await executeFile(executable, ["--version"], { cwd: repository });
    assert.equal(versionResult.stdout, `IntentPatch ${version}\n`);

    await writeFile(join(repository, "src/api.ts"), "function deleteUser(): void {}\n");
    const reportResult = await executeFile(executable, ["analyze"], { cwd: repository });

    assert.match(reportResult.stdout, /Risky API changes\s+1/);
    assert.match(reportResult.stdout, /HIGH\s+Public export removed/);
    assert.match(reportResult.stdout, /src\/api\.ts · api\/export-removed/);
  });
});

async function createRepository(repository: string): Promise<void> {
  await runGit(repository, ["init", "--quiet"]);
  await writeFile(join(repository, ".gitignore"), "node_modules/\n");
  await writeFile(join(repository, "package.json"), '{"private":true}\n');
  await writeFile(join(repository, "src/api.ts"), "export function deleteUser(): void {}\n");
  await runGit(repository, ["add", ".gitignore", "package.json", "src/api.ts"]);
  await runGit(repository, [
    "-c",
    "user.name=IntentPatch Test",
    "-c",
    "user.email=intentpatch@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "Initial fixture",
  ]);
}

async function runGit(repository: string, arguments_: readonly string[]): Promise<void> {
  await executeFile("git", [...arguments_], { cwd: repository });
}
