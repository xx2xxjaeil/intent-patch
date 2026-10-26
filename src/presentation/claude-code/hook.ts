import { isAbsolute } from "node:path";
import {
  AnalyzeAgentTurn,
  type AgentTurnDependencies,
} from "../../application/use-cases/analyze-agent-turn.js";
import { readAgentHookInput } from "../agent-hook/input.js";
import { formatAgentHookSummary } from "../agent-hook/summary.js";
import type { ClaudeHookAction } from "../cli/arguments.js";

export type ClaudeHookDependencies = AgentTurnDependencies;

/** Hook 입력 크기를 제한해 의도치 않은 대용량 stdin을 메모리에 쌓지 않는다. */
export async function readClaudeHookInput(
  input: AsyncIterable<string | Uint8Array>,
): Promise<unknown> {
  return readAgentHookInput(input);
}

/** 프롬프트는 분석 계약에만 전달하고 Hook 출력에는 집계만 반환한다. */
export async function runClaudeHook(
  action: ClaudeHookAction,
  input: unknown,
  dependencies: ClaudeHookDependencies,
): Promise<string | undefined> {
  const event = parseEvent(input);
  const turn = new AnalyzeAgentTurn(dependencies);
  switch (action) {
    case "capture": {
      assertEvent(event, "UserPromptSubmit");
      if (typeof event.prompt !== "string") throw new Error("Claude Code prompt is required");
      await turn.capture(event.sessionId, event.cwd, event.prompt);
      return undefined;
    }
    case "analyze": {
      assertEvent(event, "Stop");
      if (event.stop_hook_active === true) return undefined;
      const report = await turn.analyze(event.sessionId, event.cwd);
      const message = report === undefined ? undefined : formatAgentHookSummary(report);
      return message === undefined ? undefined : `${JSON.stringify({ systemMessage: message })}\n`;
    }
    case "clear": {
      if (event.hook_event_name !== "StopFailure" && event.hook_event_name !== "SessionEnd") {
        throw new Error("Claude Code clear hook requires StopFailure or SessionEnd");
      }
      await turn.clear(event.sessionId, event.cwd);
      return undefined;
    }
  }
}

interface HookEvent {
  readonly hook_event_name: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly prompt?: unknown;
  readonly stop_hook_active?: unknown;
}

function parseEvent(value: unknown): HookEvent {
  if (
    typeof value !== "object" ||
    value === null ||
    !("hook_event_name" in value) ||
    typeof value.hook_event_name !== "string" ||
    !("session_id" in value) ||
    typeof value.session_id !== "string" ||
    value.session_id.length === 0 ||
    value.session_id.length > 256 ||
    !("cwd" in value) ||
    typeof value.cwd !== "string" ||
    !isAbsolute(value.cwd)
  ) {
    throw new Error("Claude Code hook requires an event name, session ID, and absolute cwd");
  }
  return {
    hook_event_name: value.hook_event_name,
    sessionId: value.session_id,
    cwd: value.cwd,
    ...("prompt" in value ? { prompt: value.prompt } : {}),
    ...("stop_hook_active" in value ? { stop_hook_active: value.stop_hook_active } : {}),
  };
}

function assertEvent(event: HookEvent, expected: string): void {
  if (event.hook_event_name !== expected) {
    throw new Error(`Claude Code hook expected ${expected} event`);
  }
}
