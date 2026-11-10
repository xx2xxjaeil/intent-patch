import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FindingEvidenceValue } from "../../domain/finding.js";
import type { BaselineEntry } from "../../domain/finding-baseline.js";
import { isRecord } from "../../domain/value-guards.js";
import { isNotFoundError } from "../filesystem/is-not-found-error.js";

const defaultFile = ".intentpatch-baseline.json";

/** 정책 파일은 명시적으로 읽고 스키마를 검사해 예외 범위의 오타를 거부한다. */
export class JsonFindingBaselineLoader {
  public async load(workingDirectory: string, path?: string): Promise<readonly BaselineEntry[]> {
    const resolved = resolve(workingDirectory, path ?? defaultFile);
    let content: string;
    try {
      content = await readFile(resolved, "utf8");
    } catch (error) {
      if (path === undefined && isNotFoundError(error)) return [];
      throw error;
    }
    try {
      return parseBaseline(JSON.parse(content) as unknown);
    } catch (error) {
      throw new Error(
        `Invalid finding baseline at ${resolved}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}

export function parseBaseline(value: unknown): readonly BaselineEntry[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error('Expected { "version": 1, "entries": [...] }.');
  }
  assertFields(value, ["version", "entries"]);
  return value.entries.map((item: unknown, index: number) => parseEntry(item, index));
}

function parseEntry(value: unknown, index: number): BaselineEntry {
  if (!isRecord(value)) throw new Error(`entries[${index}] must be an object.`);
  assertFields(value, ["ruleId", "file", "evidence", "reason", "expires"]);
  const ruleId = requiredText(value.ruleId, "ruleId");
  const file = requiredText(value.file, "file");
  const reason = requiredText(value.reason, "reason");
  const expires = requiredText(value.expires, "expires");
  const parsedDate = new Date(`${expires}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(expires) ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== expires
  ) {
    throw new Error(`entries[${index}].expires must be a YYYY-MM-DD date.`);
  }
  if (!isRecord(value.evidence)) throw new Error(`entries[${index}].evidence must be an object.`);
  const evidence: Record<string, FindingEvidenceValue> = {};
  for (const [key, item] of Object.entries(value.evidence)) {
    if (
      !["string", "number", "boolean"].includes(typeof item) ||
      (typeof item === "number" && !Number.isFinite(item))
    ) {
      throw new Error(`entries[${index}].evidence.${key} must be a finite scalar.`);
    }
    evidence[key] = item as FindingEvidenceValue;
  }
  if (Object.keys(evidence).length === 0) {
    throw new Error(`entries[${index}].evidence needs at least one field to identify a finding.`);
  }
  return { ruleId, file, reason, expires, evidence };
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${field} must be non-empty text.`);
  return value.trim();
}

function assertFields(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((field) => !allowed.includes(field));
  if (unknown !== undefined) throw new Error(`Unknown field: ${unknown}`);
}
