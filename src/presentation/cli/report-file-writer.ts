import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** 명시된 출력 경로를 실행 디렉터리 기준으로 해석해 보고서를 저장한다. */
export async function writeReportFile(
  content: string,
  outputPath: string,
  invocationDirectory: string,
): Promise<string> {
  const destination = resolve(invocationDirectory, outputPath);
  await writeFile(destination, content, "utf8");
  return destination;
}
