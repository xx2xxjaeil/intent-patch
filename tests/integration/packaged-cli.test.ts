import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
    const npmEnvironment = { ...process.env, npm_config_cache: join(workspace, "npm-cache") };
    await mkdir(join(repository, "src"), { recursive: true });
    await createRepository(repository);

    const { stdout: packedFileName } = await executeFile(
      "npm",
      ["pack", "--silent", "--pack-destination", workspace],
      { cwd: process.cwd(), env: npmEnvironment },
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
        "--prefer-offline",
        tarball,
      ],
      { cwd: repository, env: npmEnvironment },
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

    const codexEvent = { session_id: "smoke", turn_id: "turn", cwd: repository };
    assert.equal(
      (
        await runHook(
          executable,
          "codex-hook",
          "capture",
          { ...codexEvent, hook_event_name: "UserPromptSubmit", prompt: "Delete the export" },
          repository,
        )
      ).code,
      0,
    );
    const codex = await runHook(
      executable,
      "codex-hook",
      "analyze",
      { ...codexEvent, hook_event_name: "Stop" },
      repository,
    );
    assert.match(JSON.parse(codex.stdout).systemMessage, /IntentPatch: 1 files changed/);

    const claudeEvent = { session_id: "smoke-claude", cwd: repository };
    assert.equal(
      (
        await runHook(
          executable,
          "claude-hook",
          "capture",
          { ...claudeEvent, hook_event_name: "UserPromptSubmit", prompt: "Delete the export" },
          repository,
        )
      ).code,
      0,
    );
    const claude = await runHook(
      executable,
      "claude-hook",
      "analyze",
      { ...claudeEvent, hook_event_name: "Stop" },
      repository,
    );
    assert.match(JSON.parse(claude.stdout).systemMessage, /IntentPatch: 1 files changed/);

    const cursorEvent = {
      conversation_id: "smoke-cursor",
      generation_id: "generation",
      workspace_roots: [repository],
    };
    assert.equal(
      (
        await runHook(
          executable,
          "cursor-hook",
          "capture",
          { ...cursorEvent, hook_event_name: "beforeSubmitPrompt", prompt: "Delete the export" },
          repository,
        )
      ).stdout,
      '{"continue":true}\n',
    );
    const cursor = await runHook(
      executable,
      "cursor-hook",
      "analyze",
      { ...cursorEvent, hook_event_name: "stop", status: "completed" },
      repository,
    );
    assert.equal(cursor.stdout, "{}\n");
    assert.match(cursor.stderr, /IntentPatch: 1 files changed/);
    assert.equal((await readdir(join(repository, ".git", "intentpatch-reports"))).length, 1);
    assert.deepEqual(await readdir(join(repository, ".git", "intentpatch-hooks")), []);
  });
});

function runHook(
  executable: string,
  adapter: string,
  action: string,
  input: unknown,
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [adapter, action], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

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
