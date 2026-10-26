import { isAbsolute } from "node:path";
import {
  type AgentTurnDependencies,
  AnalyzeAgentTurn,
} from "../../application/use-cases/analyze-agent-turn.js";
import { formatAgentHookSummary } from "../agent-hook/summary.js";
import type { CursorHookAction } from "../cli/arguments.js";
import { formatReport } from "../cli/report-formatter.js";

export interface CursorHookDependencies extends AgentTurnDependencies {
  readonly writeReport: (key: string, cwd: string, html: string) => Promise<string>;
}

export interface CursorHookResult {
  readonly output: string;
  readonly notice?: string;
}

interface CursorEvent {
  readonly hook_event_name: string;
  readonly conversationId: string;
  readonly generationId: string;
  readonly cwd: string;
  readonly prompt?: unknown;
  readonly status?: unknown;
}

/** Cursor의 JSON Hook 계약을 로컬 턴 분석으로 변환한다. 후속 모델 턴은 만들지 않는다. */
export async function runCursorHook(
  action: CursorHookAction,
  input: unknown,
  dependencies: CursorHookDependencies,
): Promise<CursorHookResult> {
  const event = parseEvent(input);
  const key = `cursor:${event.conversationId}:${event.generationId}`;
  const turn = new AnalyzeAgentTurn(dependencies);

  switch (action) {
    case "capture": {
      assertEvent(event, "beforeSubmitPrompt");
      if (typeof event.prompt !== "string") throw new Error("Cursor prompt is required");
      await turn.capture(key, event.cwd, event.prompt);
      return { output: '{"continue":true}\n' };
    }
    case "analyze": {
      assertEvent(event, "stop");
      if (event.status !== "completed") {
        await turn.clear(key, event.cwd);
        return { output: "{}\n" };
      }
      const report = await turn.analyze(key, event.cwd);
      if (report === undefined || report.changes.summary.filesChanged === 0) {
        return { output: "{}\n" };
      }
      const path = await dependencies.writeReport(
        `cursor:${event.conversationId}`,
        event.cwd,
        formatReport(report, "html"),
      );
      const summary = formatAgentHookSummary(report);
      return {
        output: "{}\n",
        notice: `${summary ?? "IntentPatch report ready."} Report: ${path}`,
      };
    }
  }
}

function parseEvent(value: unknown): CursorEvent {
  if (
    typeof value !== "object" ||
    value === null ||
    !("hook_event_name" in value) ||
    typeof value.hook_event_name !== "string" ||
    !("conversation_id" in value) ||
    !validId(value.conversation_id) ||
    !("generation_id" in value) ||
    !validId(value.generation_id) ||
    !("workspace_roots" in value) ||
    !Array.isArray(value.workspace_roots) ||
    value.workspace_roots.length !== 1 ||
    typeof value.workspace_roots[0] !== "string" ||
    !isAbsolute(value.workspace_roots[0])
  ) {
    throw new Error(
      "Cursor hook requires an event name, conversation ID, generation ID, and one absolute workspace root",
    );
  }
  return {
    hook_event_name: value.hook_event_name,
    conversationId: value.conversation_id,
    generationId: value.generation_id,
    cwd: value.workspace_roots[0],
    ...("prompt" in value ? { prompt: value.prompt } : {}),
    ...("status" in value ? { status: value.status } : {}),
  };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function assertEvent(event: CursorEvent, expected: string): void {
  if (event.hook_event_name !== expected) throw new Error(`Cursor hook expected ${expected} event`);
}
