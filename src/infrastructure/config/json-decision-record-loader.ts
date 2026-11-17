import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDecisionRecord, type DecisionRecord } from "../../domain/decision-record.js";
import { isRecord } from "../../domain/value-guards.js";
import { isNotFoundError } from "../filesystem/is-not-found-error.js";

export const decisionFileName = ".intentpatch-decisions.json";
const maximumBytes = 64 * 1024;

/** 결정 기록은 선택 이유를 담는 입력 파일이며 분석 규칙의 판정에 관여하지 않는다. */
export class JsonDecisionRecordLoader {
  public async load(workingDirectory: string): Promise<readonly DecisionRecord[]> {
    const path = resolve(workingDirectory, decisionFileName);
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(path);
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
    if (!stats.isFile() || stats.size > maximumBytes) {
      throw new Error(`Decision record must be a regular file no larger than 64 KiB: ${path}`);
    }
    try {
      return parseDecisionRecords(JSON.parse(await readFile(path, "utf8")) as unknown);
    } catch (error) {
      throw new Error(
        `Invalid decision record at ${path}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}

export function parseDecisionRecords(value: unknown): readonly DecisionRecord[] {
  if (!isRecord(value)) throw new Error("Root must be an object.");
  assertFields(value, ["version", "decisions"]);
  if (value.version !== 1 || !Array.isArray(value.decisions) || value.decisions.length > 20) {
    throw new Error('Expected { "version": 1, "decisions": [...] } with at most 20 decisions.');
  }
  const records = value.decisions.map((item: unknown, index: number) => parseDecision(item, index));
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error("Decision ids must be unique.");
  }
  return Object.freeze(records);
}

function parseDecision(value: unknown, index: number): DecisionRecord {
  if (!isRecord(value)) throw new Error(`decisions[${index}] must be an object.`);
  assertFields(value, [
    "id",
    "question",
    "options",
    "selectedOptionId",
    "rationale",
    "relatedPaths",
  ]);
  if (!Array.isArray(value.options) || !Array.isArray(value.relatedPaths)) {
    throw new Error(`decisions[${index}] needs options and relatedPaths arrays.`);
  }
  const options = value.options.map((option: unknown, optionIndex: number) => {
    if (!isRecord(option))
      throw new Error(`decisions[${index}].options[${optionIndex}] must be an object.`);
    assertFields(option, ["id", "title", "benefits", "tradeoffs"]);
    return {
      id: requireString(option.id, "option id"),
      title: requireString(option.title, "option title"),
      benefits: requireStringArray(option.benefits, "benefits"),
      tradeoffs: requireStringArray(option.tradeoffs, "tradeoffs"),
    };
  });
  return createDecisionRecord({
    id: requireString(value.id, "decision id"),
    question: requireString(value.question, "question"),
    options,
    selectedOptionId: requireString(value.selectedOptionId, "selectedOptionId"),
    rationale: requireString(value.rationale, "rationale"),
    relatedPaths: requireStringArray(value.relatedPaths, "relatedPaths"),
  });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function requireStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${field} must be an array of strings.`);
  }
  return value;
}

function assertFields(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((field) => !allowed.includes(field));
  if (unknown !== undefined) throw new Error(`Unknown field: ${unknown}`);
}
