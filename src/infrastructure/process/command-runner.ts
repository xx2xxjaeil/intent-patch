import { execFile } from "node:child_process";

export interface CommandRequest {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<string>;
}

export class CommandExecutionError extends Error {
  public constructor(
    message: string,
    public readonly executable: string,
    public readonly exitCode: number | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CommandExecutionError";
  }
}

export class NodeCommandRunner implements CommandRunner {
  public run(request: CommandRequest): Promise<string> {
    return new Promise((resolve, reject) => {
      // shell을 거치지 않는 execFile을 사용해 ref나 경로가 명령으로 재해석되지 않게 한다.
      execFile(
        request.executable,
        [...request.arguments],
        {
          cwd: request.cwd,
          encoding: "utf8",
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve(stdout);
            return;
          }

          const details = stderr.trim();
          const message = details || error.message;
          reject(
            new CommandExecutionError(
              message,
              request.executable,
              typeof error.code === "number" ? error.code : null,
              {
                cause: error,
              },
            ),
          );
        },
      );
    });
  }
}
