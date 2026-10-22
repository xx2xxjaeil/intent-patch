import { isAbsolute } from "node:path";
import type { AgentIntentSessionStore } from "../../application/ports/agent-intent-session-store.js";
import type { ChangeReport } from "../../domain/report.js";
import type { RepositoryAnalysisOptions } from "../analyze-repository.js";
import type { ClaudeHookAction } from "../cli/arguments.js";

const maximumInputBytes = 256 * 1024;
const maximumPromptBytes = 64 * 1024;

export interface ClaudeHookDependencies {
  readonly store: AgentIntentSessionStore;
  readonly analyze: (options: RepositoryAnalysisOptions) => Promise<ChangeReport>;
}

/** Hook 입력 크기를 제한해 의도치 않은 대용량 stdin을 메모리에 쌓지 않는다. */
export async function readClaudeHookInput(
  input: AsyncIterable<string | Uint8Array>,
): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of input) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    length += bytes.byteLength;
    if (length > maximumInputBytes) throw new Error("Claude Code hook input exceeds 256 KiB");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    // JSON parser diagnostics can contain a fragment of the original prompt.
    throw new Error("Claude Code hook input must be valid JSON");
  }
}

/** 프롬프트는 분석 계약에만 전달하고 Hook 출력에는 집계만 반환한다. */
export async function runClaudeHook(
  action: ClaudeHookAction,
  input: unknown,
  dependencies: ClaudeHookDependencies,
): Promise<string | undefined> {
  const event = parseEvent(input);
  switch (action) {
    case "capture": {
      assertEvent(event, "UserPromptSubmit");
      if (
        typeof event.prompt !== "string" ||
        event.prompt.trim().length === 0 ||
        Buffer.byteLength(event.prompt, "utf8") > maximumPromptBytes
      ) {
        throw new Error("Claude Code prompt must be nonempty and at most 64 KiB");
      }
      await dependencies.store.capture(event.sessionId, event.cwd, event.prompt);
      return undefined;
    }
    case "analyze": {
      assertEvent(event, "Stop");
      if (event.stop_hook_active === true) return undefined;
      const captured = await dependencies.store.take(event.sessionId, event.cwd);
      if (captured === undefined) return undefined;
      const report = await dependencies.analyze({
        workingDirectory: event.cwd,
        baseRef: captured.baseRef,
        intentOverride: captured.intent,
      });
      if (report.changes.summary.filesChanged === 0) return undefined;
      const { bySeverity, total } = report.findings.summary;
      const message = `IntentPatch: ${report.changes.summary.filesChanged} files changed; ${total} ${total === 1 ? "finding" : "findings"} (high ${bySeverity.high}, medium ${bySeverity.medium}, low ${bySeverity.low}).`;
      return `${JSON.stringify({ systemMessage: message })}\n`;
    }
    case "clear": {
      if (event.hook_event_name !== "StopFailure" && event.hook_event_name !== "SessionEnd") {
        throw new Error("Claude Code clear hook requires StopFailure or SessionEnd");
      }
      await dependencies.store.clear(event.sessionId, event.cwd);
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
