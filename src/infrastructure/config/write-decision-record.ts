import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decisionFileName } from "./json-decision-record-loader.js";

/** 빈 결정 기록 파일을 안전하게 만들고 작성자가 선택 이유를 직접 채우게 한다. */
export async function writeDecisionRecord(workingDirectory: string): Promise<string> {
  const path = resolve(workingDirectory, decisionFileName);
  try {
    await writeFile(path, `${JSON.stringify({ version: 1, decisions: [] }, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`Decision record already exists: ${path}`);
    }
    throw error;
  }
  return path;
}
