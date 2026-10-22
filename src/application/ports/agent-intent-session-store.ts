export interface CapturedAgentIntent {
  readonly intent: string;
  readonly baseRef: string;
}

/** 에이전트의 한 턴 동안만 요청문을 보관하는 출력 포트다. */
export interface AgentIntentSessionStore {
  capture(sessionId: string, workingDirectory: string, intent: string): Promise<void>;
  take(sessionId: string, workingDirectory: string): Promise<CapturedAgentIntent | undefined>;
  clear(sessionId: string, workingDirectory: string): Promise<void>;
}
