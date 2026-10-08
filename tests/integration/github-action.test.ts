import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Finding } from "../../src/domain/finding.js";
import type { GitHubActionRuntime } from "../../src/presentation/github/action-runtime.js";
import { runGitHubAction } from "../../src/presentation/github/run-action.js";

const executeFile = promisify(execFile);
const bundledAction = fileURLToPath(new URL("../../action-dist/index.cjs", import.meta.url));

describe("GitHub Action integration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  it("analyzes a pull request and writes summaries, reports, and outputs", async () => {
    const { repository, eventPath } = await createBreakingRepository();
    temporaryDirectories.push(repository);
    const runtime = new FakeRuntime(
      {},
      {
        GITHUB_WORKSPACE: repository,
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
      },
    );

    const result = await runGitHubAction(runtime);

    assert.equal(result.qualityGateFailed, true);
    assert.equal(runtime.outputs.get("high-findings"), "1");
    assert.equal(runtime.annotations.length, 1);
    assert.match(runtime.summaries.join(""), /Public export removed/);
    const jsonReport = runtime.outputs.get("json-report");
    const htmlReport = runtime.outputs.get("html-report");
    assert.ok(jsonReport);
    assert.ok(htmlReport);
    assert.match(await readFile(jsonReport, "utf8"), /"api\/export-removed"/);
    assert.match(await readFile(htmlReport, "utf8"), /Agent Change Report/);
  });

  it("runs the bundled action without installing repository dependencies", async () => {
    const { repository, eventPath } = await createBreakingRepository();
    temporaryDirectories.push(repository);
    const outputFile = join(repository, "github-output");
    const summaryFile = join(repository, "github-summary");
    await Promise.all([writeFile(outputFile, ""), writeFile(summaryFile, "")]);

    await assert.rejects(
      () =>
        executeFile("node", [bundledAction], {
          cwd: repository,
          env: {
            ...process.env,
            GITHUB_WORKSPACE: repository,
            GITHUB_EVENT_NAME: "pull_request",
            GITHUB_EVENT_PATH: eventPath,
            GITHUB_OUTPUT: outputFile,
            GITHUB_STEP_SUMMARY: summaryFile,
          },
        }),
      /Command failed/,
    );

    assert.match(await readFile(outputFile, "utf8"), /high-findings<<[^\n]+\n1\n/);
    assert.match(await readFile(summaryFile, "utf8"), /Public export removed/);
    assert.match(
      await readFile(join(repository, "intentpatch-report", "intentpatch-report.html"), "utf8"),
      /Agent Change Report/,
    );
  });
});

class FakeRuntime implements GitHubActionRuntime {
  public readonly outputs = new Map<string, string>();
  public readonly summaries: string[] = [];
  public readonly annotations: Finding[] = [];

  public constructor(
    private readonly inputs: Readonly<Record<string, string>>,
    private readonly environment: Readonly<Record<string, string>>,
  ) {}

  public getInput(name: string): string | undefined {
    return this.inputs[name];
  }

  public getEnvironment(name: string): string | undefined {
    return this.environment[name];
  }

  public async setOutput(name: string, value: string): Promise<void> {
    this.outputs.set(name, value);
  }

  public async addSummary(markdown: string): Promise<void> {
    this.summaries.push(markdown);
  }

  public annotate(finding: Finding): void {
    this.annotations.push(finding);
  }

  public info(_message: string): void {}

  public error(_message: string): void {}
}

async function commitAll(repository: string, message: string): Promise<void> {
  await runGit(repository, ["add", "."]);
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
    message,
  ]);
}

async function createBreakingRepository(): Promise<{
  readonly repository: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly eventPath: string;
}> {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-action-test-"));
  await runGit(repository, ["init", "--quiet"]);
  await writeFile(join(repository, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(
    join(repository, "api.ts"),
    "export function deleteUser(id: string): void { console.log(id); }\n",
  );
  await commitAll(repository, "Base");
  const baseRef = await readHead(repository);

  await writeFile(
    join(repository, "api.ts"),
    "function deleteUser(id: string): void { console.log(id); }\n",
  );
  await commitAll(repository, "Remove export");
  const headRef = await readHead(repository);
  const eventPath = join(repository, "event.json");
  await writeFile(
    eventPath,
    JSON.stringify({ pull_request: { base: { sha: baseRef }, head: { sha: headRef } } }),
  );
  return { repository, baseRef, headRef, eventPath };
}

async function readHead(repository: string): Promise<string> {
  return (await executeFile("git", ["rev-parse", "HEAD"], { cwd: repository })).stdout.trim();
}

async function runGit(repository: string, arguments_: readonly string[]): Promise<void> {
  await executeFile("git", [...arguments_], { cwd: repository });
}
