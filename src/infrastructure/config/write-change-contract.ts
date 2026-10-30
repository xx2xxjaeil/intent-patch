import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ChangeContract } from "../../domain/change-contract.js";

/** 기존 계약을 덮어쓰지 않고 새 저장소 설정만 생성한다. */
export async function writeChangeContract(
  workingDirectory: string,
  contract: ChangeContract,
): Promise<string> {
  const path = resolve(workingDirectory, ".intentpatch.json");
  try {
    await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error(`Change contract already exists: ${path}`);
    }
    throw error;
  }
  return path;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
