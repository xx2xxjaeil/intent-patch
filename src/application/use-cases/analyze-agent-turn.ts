import type { ChangeReport } from "../../domain/report.js";
import type { AgentIntentSessionStore } from "../ports/agent-intent-session-store.js";

const maximumPromptBytes = 64 * 1024;

export interface AgentTurnAnalysisRequest {
  readonly workingDirectory: string;
  readonly baseRef: string;
  readonly intentOverride: string;
}

export interface AgentTurnDependencies {
  readonly store: AgentIntentSessionStore;
  readonly analyze: (request: AgentTurnAnalysisRequest) => Promise<ChangeReport>;
}

/** 에이전트별 이벤트 형식과 무관하게 요청 보관·Git 비교를 한 흐름으로 묶는다. */
export class AnalyzeAgentTurn {
  public constructor(private readonly dependencies: AgentTurnDependencies) {}

  public async capture(key: string, cwd: string, prompt: string): Promise<void> {
    if (prompt.trim().length === 0 || Buffer.byteLength(prompt, "utf8") > maximumPromptBytes) {
      throw new Error("Agent hook prompt must be nonempty and at most 64 KiB");
    }
    await this.dependencies.store.capture(key, cwd, prompt);
  }

  public async analyze(key: string, cwd: string): Promise<ChangeReport | undefined> {
    const captured = await this.dependencies.store.take(key, cwd);
    if (captured === undefined) return undefined;
    return this.dependencies.analyze({
      workingDirectory: cwd,
      baseRef: captured.baseRef,
      intentOverride: captured.intent,
    });
  }

  public async clear(key: string, cwd: string): Promise<void> {
    await this.dependencies.store.clear(key, cwd);
  }
}
