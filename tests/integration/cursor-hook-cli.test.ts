import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

describe("Cursor CLI hook integration", () => {
  it("writes a private HTML report for a completed Git change without a follow-up model turn", async () => {
    const repo = await fixtureRepository();
    const event = {
      conversation_id: "conversation",
      generation_id: "generation",
      workspace_roots: [repo],
    };
    const captured = await runHook("capture", {
      ...event,
      hook_event_name: "beforeSubmitPrompt",
      prompt: "SECRET_SENTINEL: change answer",
    });
    assert.deepEqual(captured, { code: 0, stdout: '{"continue":true}\n', stderr: "" });
    await writeFile(join(repo, "feature.ts"), "export const answer = 2;\n");

    const analyzed = await runHook("analyze", {
      ...event,
      hook_event_name: "stop",
      status: "completed",
    });
    assert.equal(analyzed.code, 0, analyzed.stderr);
    assert.equal(analyzed.stdout, "{}\n");
    assert.match(analyzed.stderr, /IntentPatch: 1 files changed/);
    assert.equal(analyzed.stdout.includes("SECRET_SENTINEL"), false);
    assert.equal(analyzed.stderr.includes("SECRET_SENTINEL"), false);
    assert.deepEqual(await readdir(join(repo, ".git", "intentpatch-hooks")), []);

    const reportDirectory = join(repo, ".git", "intentpatch-reports");
    const reports = await readdir(reportDirectory);
    assert.equal(reports.length, 1);
    assert.match(reports[0] ?? "", /^[0-9a-f]{64}\.html$/u);
    const path = join(reportDirectory, reports[0] ?? "");
    assert.match(await readFile(path, "utf8"), /SECRET_SENTINEL/);
    if (process.platform !== "win32") {
      assert.equal((await stat(reportDirectory)).mode & 0o077, 0);
      assert.equal((await stat(path)).mode & 0o077, 0);
    }

    const nextGeneration = { ...event, generation_id: "generation-2" };
    await runHook("capture", {
      ...nextGeneration,
      hook_event_name: "beforeSubmitPrompt",
      prompt: "SECOND_SENTINEL: change answer again",
    });
    await writeFile(join(repo, "feature.ts"), "export const answer = 3;\n");
    const nextResult = await runHook("analyze", {
      ...nextGeneration,
      hook_event_name: "stop",
      status: "completed",
    });
    assert.equal(nextResult.code, 0, nextResult.stderr);
    assert.deepEqual(await readdir(reportDirectory), reports);
    const latestHtml = await readFile(path, "utf8");
    assert.match(latestHtml, /SECOND_SENTINEL/);
    assert.doesNotMatch(latestHtml, /SECRET_SENTINEL/);
  });

  it("discards a stopped generation that did not complete", async () => {
    const repo = await fixtureRepository();
    const event = {
      conversation_id: "conversation",
      generation_id: "aborted",
      workspace_roots: [repo],
    };
    await runHook("capture", {
      ...event,
      hook_event_name: "beforeSubmitPrompt",
      prompt: "SECRET_SENTINEL",
    });
    const result = await runHook("analyze", {
      ...event,
      hook_event_name: "stop",
      status: "aborted",
    });
    assert.deepEqual(result, { code: 0, stdout: "{}\n", stderr: "" });
    assert.deepEqual(await readdir(join(repo, ".git", "intentpatch-hooks")), []);
  });
});

async function fixtureRepository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "intentpatch-cursor-cli-"));
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
  return repo;
}

function runHook(
  action: string,
  input: unknown,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, "cursor-hook", action], {
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
