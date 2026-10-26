import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentIntentSessionStore,
  CapturedAgentIntent,
} from "../../src/application/ports/agent-intent-session-store.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createFindingSet } from "../../src/domain/finding.js";
import type { ChangeReport } from "../../src/domain/report.js";
import { runCodexHook } from "../../src/presentation/codex/hook.js";

const cwd = "/repo";
const session_id = "session-a";

describe("Codex hook", () => {
  it("captures and consumes each turn independently without printing the prompt", async () => {
    const saved = new Map<string, CapturedAgentIntent>();
    const requests: unknown[] = [];
    const store: AgentIntentSessionStore = {
      capture: async (key, _cwd, intent) => {
        saved.set(key, { intent, baseRef: "a".repeat(40) });
      },
      take: async (key) => {
        const value = saved.get(key);
        saved.delete(key);
        return value;
      },
      clear: async (key) => {
        saved.delete(key);
      },
    };
    const dependencies = {
      store,
      analyze: async (request: unknown) => {
        requests.push(request);
        return report(1);
      },
    };

    for (const turn_id of ["turn-1", "turn-2"]) {
      const output = await runCodexHook(
        "capture",
        {
          hook_event_name: "UserPromptSubmit",
          session_id,
          turn_id,
          cwd,
          prompt: `SECRET-${turn_id}`,
        },
        dependencies,
      );
      assert.equal(output, undefined);
    }
    assert.equal(saved.size, 2);

    const output = await runCodexHook(
      "analyze",
      { hook_event_name: "Stop", session_id, turn_id: "turn-1", cwd },
      dependencies,
    );
    assert.deepEqual(JSON.parse(output ?? ""), {
      systemMessage: "IntentPatch: 1 files changed; 0 findings (high 0, medium 0, low 0).",
    });
    assert.equal(output?.includes("SECRET"), false);
    assert.deepEqual(requests, [
      { workingDirectory: cwd, baseRef: "a".repeat(40), intentOverride: "SECRET-turn-1" },
    ]);
    assert.equal(saved.size, 1);

    await runCodexHook(
      "clear",
      { hook_event_name: "Interrupt", session_id, turn_id: "turn-2", cwd },
      dependencies,
    );
    assert.equal(saved.size, 0);
    assert.equal(
      await runCodexHook(
        "analyze",
        { hook_event_name: "Stop", session_id, turn_id: "turn-2", cwd },
        dependencies,
      ),
      "{}\n",
    );
  });

  it("rejects wrong events and identifiers without echoing the payload", async () => {
    const dependencies = { store: emptyStore(), analyze: async () => report(0) };
    await assert.rejects(
      runCodexHook(
        "capture",
        { hook_event_name: "Stop", session_id, turn_id: "turn-a", cwd, prompt: "SECRET" },
        dependencies,
      ),
      /expected UserPromptSubmit/,
    );
    await assert.rejects(
      runCodexHook(
        "capture",
        { hook_event_name: "UserPromptSubmit", session_id, turn_id: "", cwd, prompt: "SECRET" },
        dependencies,
      ),
      (error: Error) => !error.message.includes("SECRET"),
    );
  });
});

function emptyStore(): AgentIntentSessionStore {
  return { capture: async () => {}, take: async () => undefined, clear: async () => {} };
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
    findings: createFindingSet([]),
  } as ChangeReport;
}
