import type { ChangeSet } from "./change.js";
import type { FindingSet, Severity } from "./finding.js";

export interface DecisionOption {
  readonly id: string;
  readonly title: string;
  readonly benefits: readonly string[];
  readonly tradeoffs: readonly string[];
}

/** 선택 이유는 작성자의 설명이며 분석기가 사실로 판정하지 않는다. */
export interface DecisionRecord {
  readonly id: string;
  readonly question: string;
  readonly options: readonly DecisionOption[];
  readonly selectedOptionId: string;
  readonly rationale: string;
  readonly relatedPaths: readonly string[];
}

export interface DecisionFindingReference {
  readonly index: number;
  readonly ruleId: string;
  readonly file: string;
  readonly severity: Severity;
}

export interface DecisionReview extends DecisionRecord {
  /** 실제 비교 결과에 나타난 경로만 포함한다. */
  readonly changedPaths: readonly string[];
  readonly relatedFindings: readonly DecisionFindingReference[];
}

export function createDecisionRecord(input: DecisionRecord): DecisionRecord {
  const id = requireId(input.id, "decision id");
  const question = requireText(input.question, "question", 500);
  const rationale = requireText(input.rationale, "rationale", 4000);
  if (input.options.length < 2 || input.options.length > 10) {
    throw new Error(`${id}: options must contain 2 to 10 alternatives.`);
  }
  const options = input.options.map((option) => ({
    id: requireId(option.id, "option id"),
    title: requireText(option.title, "option title", 200),
    benefits: normalizePoints(option.benefits, "benefits"),
    tradeoffs: normalizePoints(option.tradeoffs, "tradeoffs"),
  }));
  const optionIds = options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) {
    throw new Error(`${id}: option ids must be unique.`);
  }
  const selectedOptionId = requireId(input.selectedOptionId, "selectedOptionId");
  if (!optionIds.includes(selectedOptionId)) {
    throw new Error(`${id}: selectedOptionId must match an option id.`);
  }
  if (input.relatedPaths.length === 0 || input.relatedPaths.length > 50) {
    throw new Error(`${id}: relatedPaths must contain 1 to 50 exact repository paths.`);
  }
  const relatedPaths = input.relatedPaths.map(normalizePath);
  if (new Set(relatedPaths).size !== relatedPaths.length) {
    throw new Error(`${id}: relatedPaths must be unique.`);
  }
  return Object.freeze({
    id,
    question,
    rationale,
    selectedOptionId,
    options: Object.freeze(options.map((option) => Object.freeze(option))),
    relatedPaths: Object.freeze(relatedPaths),
  });
}

/** 작성자가 선언한 경로와 실제 Git 변경·finding의 교집합만 근거로 연결한다. */
export function connectDecisions(
  decisions: readonly DecisionRecord[],
  changes: ChangeSet,
  findings: FindingSet,
): readonly DecisionReview[] {
  return decisions.map((decision) => {
    const declared = new Set(decision.relatedPaths);
    const changedPaths = changes.files
      .filter(
        (change) =>
          declared.has(change.path) ||
          (change.previousPath !== undefined && declared.has(change.previousPath)),
      )
      .map((change) => change.path);
    const matched = new Set(changedPaths);
    const relatedFindings = findings.items.flatMap((finding, index) =>
      matched.has(finding.file)
        ? [{ index, ruleId: finding.ruleId, file: finding.file, severity: finding.severity }]
        : [],
    );
    return Object.freeze({
      ...decision,
      changedPaths: Object.freeze(changedPaths),
      relatedFindings: Object.freeze(relatedFindings),
    });
  });
}

function requireId(value: string, field: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) {
    throw new Error(`${field} must be a lowercase slug (up to 64 characters).`);
  }
  return value;
}

function requireText(value: string, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${field} must be non-empty text up to ${maxLength} characters.`);
  }
  return value.trim();
}

function normalizePoints(values: readonly string[], field: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 10) {
    throw new Error(`${field} must contain 1 to 10 points.`);
  }
  return Object.freeze(values.map((value) => requireText(value, field, 500)));
}

function normalizePath(value: string): string {
  if (typeof value !== "string") throw new Error("relatedPaths must contain strings.");
  const path = value.trim().replaceAll("\\", "/");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("*") ||
    path.includes("?") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..") ||
    [...path].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error(`relatedPaths must be exact repository-relative paths: ${path}`);
  }
  return path;
}
