import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentIntentSessionStore,
  CapturedAgentIntent,
} from "../../src/application/ports/agent-intent-session-store.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createCodeStructureAnalysis } from "../../src/domain/code-structure.js";
import { createFindingSet } from "../../src/domain/finding.js";
import { createImpactAnalysis } from "../../src/domain/impact.js";
import type { ChangeReport } from "../../src/domain/report.js";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";
import { createTestChangeAnalysis } from "../../src/domain/test-change.js";
import { runCursorHook } from "../../src/presentation/cursor/hook.js";

const cwd = "/repo";
const conversation_id = "conversation-a";

describe("Cursor hook", () => {
  it("keeps generations separate and writes a report without requesting another model turn", async () => {
    const saved = new Map<string, CapturedAgentIntent>();
    const requests: unknown[] = [];
    const reports: { key: string; cwd: string; html: string }[] = [];
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
      writeReport: async (key: string, root: string, html: string) => {
        reports.push({ key, cwd: root, html });
        return "/repo/.git/intentpatch-reports/report.html";
      },
    };

    for (const generation_id of ["generation-1", "generation-2"]) {
      const result = await runCursorHook(
        "capture",
        {
          hook_event_name: "beforeSubmitPrompt",
          conversation_id,
          generation_id,
          workspace_roots: [cwd],
          prompt: `SECRET-${generation_id}`,
        },
        dependencies,
      );
      assert.deepEqual(result, { output: '{"continue":true}\n' });
    }
    assert.equal(saved.size, 2);

    const result = await runCursorHook(
      "analyze",
      {
        hook_event_name: "stop",
        conversation_id,
        generation_id: "generation-1",
        workspace_roots: [cwd],
        status: "completed",
      },
      dependencies,
    );
    assert.equal(result.output, "{}\n");
    assert.match(result.notice ?? "", /IntentPatch: 1 files changed/);
    assert.equal(result.notice?.includes("SECRET"), false);
    assert.equal(result.output.includes("followup_message"), false);
    assert.deepEqual(requests, [
      { workingDirectory: cwd, baseRef: "a".repeat(40), intentOverride: "SECRET-generation-1" },
    ]);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.key, "cursor:conversation-a");
    assert.match(reports[0]?.html ?? "", /<html/);
    assert.equal(saved.size, 1);

    assert.deepEqual(
      await runCursorHook(
        "analyze",
        {
          hook_event_name: "stop",
          conversation_id,
          generation_id: "generation-2",
          workspace_roots: [cwd],
          status: "aborted",
        },
        dependencies,
      ),
      { output: "{}\n" },
    );
    assert.equal(saved.size, 0);
    assert.equal(requests.length, 1);
  });

  it("rejects ambiguous workspaces and wrong events without echoing the prompt", async () => {
    const dependencies = {
      store: emptyStore(),
      analyze: async () => report(0),
      writeReport: async () => "/report.html",
    };
    await assert.rejects(
      runCursorHook(
        "capture",
        {
          hook_event_name: "beforeSubmitPrompt",
          conversation_id,
          generation_id: "generation",
          workspace_roots: [cwd, "/other"],
          prompt: "SECRET",
        },
        dependencies,
      ),
      (error: Error) => !error.message.includes("SECRET"),
    );
    await assert.rejects(
      runCursorHook(
        "capture",
        {
          hook_event_name: "stop",
          conversation_id,
          generation_id: "generation",
          workspace_roots: [cwd],
          prompt: "SECRET",
        },
        dependencies,
      ),
      /expected beforeSubmitPrompt/,
    );
  });
});

function emptyStore(): AgentIntentSessionStore {
  return { capture: async () => {}, take: async () => undefined, clear: async () => {} };
}

function report(files: number): ChangeReport {
  return {
    target: { baseRef: "HEAD" },
    changes: createChangeSet(
      Array.from({ length: files }, (_, index) => ({
        path: `file-${index}.ts`,
        kind: "modified" as const,
        lines: { kind: "measured" as const, additions: 1, deletions: 0 },
      })),
    ),
    findings: createFindingSet([]),
    symbolChanges: createSymbolChangeSet([]),
    codeStructure: createCodeStructureAnalysis({
      sourceFiles: files,
      duplicateCandidates: [],
      singleImplementationAbstractions: [],
    }),
    impact: createImpactAnalysis({
      sourceFiles: files,
      changedModules: [],
      dependencies: [],
      impactedFiles: [],
    }),
    testChanges: createTestChangeAnalysis({ testFiles: [], sourceCoverage: [] }),
  };
}
