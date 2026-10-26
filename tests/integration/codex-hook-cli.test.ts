import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const cli = fileURLToPath(new URL("../../src/presentation/cli/main.ts", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Codex CLI hook integration", () => {
  it("analyzes a real Git change and consumes its private turn state", async () => {
    const repo = await mkdtemp(join(tmpdir(), "intentpatch-codex-cli-"));
    repositories.push(repo);
    await executeFile("git", ["init", "--quiet"], { cwd: repo });
    await writeFile(join(repo, "feature.ts"), "export const answer = 1;\n");
    await executeFile("git", ["add", "feature.ts"], { cwd: repo });
    await executeFile(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "Fixture",
      ],
      { cwd: repo },
    );

    const event = { session_id: "session", turn_id: "turn", cwd: repo };
    const captured = await runHook("capture", {
      ...event,
      hook_event_name: "UserPromptSubmit",
      prompt: "SECRET_SENTINEL: change answer",
    });
    assert.deepEqual(captured, { code: 0, stdout: "", stderr: "" });
    await writeFile(join(repo, "feature.ts"), "export const answer = 2;\n");

    const analyzed = await runHook("analyze", { ...event, hook_event_name: "Stop" });
    assert.equal(analyzed.code, 0, analyzed.stderr);
    assert.match(JSON.parse(analyzed.stdout).systemMessage, /IntentPatch: 1 files changed/);
    assert.equal(analyzed.stdout.includes("SECRET_SENTINEL"), false);
    assert.equal(analyzed.stderr.includes("SECRET_SENTINEL"), false);
    assert.deepEqual(await readdir(join(repo, ".git", "intentpatch-hooks")), []);
  });
});

function runHook(
  action: string,
  input: unknown,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, "codex-hook", action], {
      cwd: projectRoot,
    });
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
