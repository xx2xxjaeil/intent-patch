import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentIntentSessionStore,
  CapturedAgentIntent,
} from "../../src/application/ports/agent-intent-session-store.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createFindingSet } from "../../src/domain/finding.js";
import type { ChangeReport } from "../../src/domain/report.js";
import { readClaudeHookInput, runClaudeHook } from "../../src/presentation/claude-code/hook.js";

const cwd = "/repo";
const session_id = "session-1";

describe("Claude Code hook", () => {
  it("captures the prompt but returns no prompt content", async () => {
    const captured: string[] = [];
    const store = fakeStore({
      capture: async (_session, _cwd, intent) => {
        captured.push(intent);
      },
    });
    const output = await runClaudeHook(
      "capture",
      {
        hook_event_name: "UserPromptSubmit",
        session_id,
        cwd,
        prompt: "비밀 요청: 회원 탈퇴",
      },
      { store, analyze: async () => report(0) },
    );

    assert.equal(output, undefined);
    assert.deepEqual(captured, ["비밀 요청: 회원 탈퇴"]);
  });

  it("uses the captured intent and base commit, but only prints counts", async () => {
    const requests: unknown[] = [];
    const output = await runClaudeHook(
      "analyze",
      {
        hook_event_name: "Stop",
        session_id,
        cwd,
      },
      {
        store: fakeStore({
          take: async () => ({ intent: "private prompt", baseRef: "a".repeat(40) }),
        }),
        analyze: async (options) => {
          requests.push(options);
          return report(2);
        },
      },
    );

    assert.deepEqual(requests, [
      { workingDirectory: cwd, baseRef: "a".repeat(40), intentOverride: "private prompt" },
    ]);
    assert.deepEqual(JSON.parse(output ?? ""), {
      systemMessage: "IntentPatch: 2 files changed; 1 finding (high 1, medium 0, low 0).",
    });
    assert.equal(output?.includes("private prompt"), false);
  });

  it("skips recursive Stop hooks and clears failed sessions", async () => {
    let takeCalls = 0;
    let clearCalls = 0;
    const store = fakeStore({
      take: async () => {
        takeCalls += 1;
        return undefined;
      },
      clear: async () => {
        clearCalls += 1;
      },
    });
    const analyze = async () => report(0);
    assert.equal(
      await runClaudeHook(
        "analyze",
        {
          hook_event_name: "Stop",
          session_id,
          cwd,
          stop_hook_active: true,
        },
        { store, analyze },
      ),
      undefined,
    );
    await runClaudeHook(
      "clear",
      { hook_event_name: "SessionEnd", session_id, cwd },
      { store, analyze },
    );
    await runClaudeHook(
      "clear",
      { hook_event_name: "StopFailure", session_id, cwd },
      { store, analyze },
    );
    assert.equal(takeCalls, 0);
    assert.equal(clearCalls, 2);
  });

  it("rejects mismatched events and oversized prompts", async () => {
    const dependencies = { store: fakeStore({}), analyze: async () => report(0) };
    await assert.rejects(
      runClaudeHook("capture", { hook_event_name: "Stop", session_id, cwd }, dependencies),
      /expected UserPromptSubmit/,
    );
    await assert.rejects(
      runClaudeHook(
        "capture",
        {
          hook_event_name: "UserPromptSubmit",
          session_id,
          cwd,
          prompt: "x".repeat(65 * 1024),
        },
        dependencies,
      ),
      /at most 64 KiB/,
    );
  });

  it("bounds stdin and does not echo invalid JSON", async () => {
    async function* invalid(): AsyncIterable<string> {
      yield '{"prompt":"SECRET"';
    }
    async function* oversized(): AsyncIterable<string> {
      yield "x".repeat(257 * 1024);
    }
    await assert.rejects(readClaudeHookInput(invalid()), (error: Error) => {
      assert.equal(error.message.includes("SECRET"), false);
      return true;
    });
    await assert.rejects(readClaudeHookInput(oversized()), /exceeds 256 KiB/);
  });
});

function fakeStore(overrides: Partial<AgentIntentSessionStore>): AgentIntentSessionStore {
  return {
    capture: async () => {},
    take: async (): Promise<CapturedAgentIntent | undefined> => undefined,
    clear: async () => {},
    ...overrides,
  };
}

function report(files: number): ChangeReport {
  return {
    changes: createChangeSet(
      Array.from({ length: files }, (_, index) => ({
        path: `file-${index}.ts`,
        kind: "modified" as const,
        lines: { kind: "measured" as const, additions: 1, deletions: 0 },
      })),
    ),
    findings: createFindingSet([
      {
        ruleId: "test",
        severity: "high",
        title: "private prompt",
        description: "",
        file: "file-0.ts",
        evidence: {},
      },
    ]),
  } as ChangeReport;
}
