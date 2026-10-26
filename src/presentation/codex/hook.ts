import { isAbsolute } from "node:path";
import {
  type AgentTurnDependencies,
  AnalyzeAgentTurn,
} from "../../application/use-cases/analyze-agent-turn.js";
import { formatAgentHookSummary } from "../agent-hook/summary.js";
import type { CodexHookAction } from "../cli/arguments.js";

interface CodexEvent {
  readonly hook_event_name: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly cwd: string;
  readonly prompt?: unknown;
  readonly stop_hook_active?: unknown;
}

/** Codex의 턴 식별자를 사용해 같은 대화의 연속 요청을 서로 덮어쓰지 않는다. */
export async function runCodexHook(
  action: CodexHookAction,
  input: unknown,
  dependencies: AgentTurnDependencies,
): Promise<string | undefined> {
  const event = parseEvent(input);
  const key = `codex:${event.sessionId}:${event.turnId}`;
  const turn = new AnalyzeAgentTurn(dependencies);

  switch (action) {
    case "capture": {
      assertEvent(event, "UserPromptSubmit");
      if (typeof event.prompt !== "string") throw new Error("Codex prompt is required");
      await turn.capture(key, event.cwd, event.prompt);
      return undefined;
    }
    case "analyze": {
      assertEvent(event, "Stop");
      if (event.stop_hook_active === true) return "{}\n";
      const report = await turn.analyze(key, event.cwd);
      const message = report === undefined ? undefined : formatAgentHookSummary(report);
      return message === undefined ? "{}\n" : `${JSON.stringify({ systemMessage: message })}\n`;
    }
    case "clear": {
      assertEvent(event, "Interrupt");
      await turn.clear(key, event.cwd);
      return undefined;
    }
  }
}

function parseEvent(value: unknown): CodexEvent {
  if (
    typeof value !== "object" ||
    value === null ||
    !("hook_event_name" in value) ||
    typeof value.hook_event_name !== "string" ||
    !("session_id" in value) ||
    !validId(value.session_id) ||
    !("turn_id" in value) ||
    !validId(value.turn_id) ||
    !("cwd" in value) ||
    typeof value.cwd !== "string" ||
    !isAbsolute(value.cwd)
  ) {
    throw new Error("Codex hook requires an event name, session ID, turn ID, and absolute cwd");
  }
  return {
    hook_event_name: value.hook_event_name,
    sessionId: value.session_id,
    turnId: value.turn_id,
    cwd: value.cwd,
    ...("prompt" in value ? { prompt: value.prompt } : {}),
    ...("stop_hook_active" in value ? { stop_hook_active: value.stop_hook_active } : {}),
  };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function assertEvent(event: CodexEvent, expected: string): void {
  if (event.hook_event_name !== expected) throw new Error(`Codex hook expected ${expected} event`);
}
