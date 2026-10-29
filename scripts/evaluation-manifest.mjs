import { compareEvaluationLabels } from "./evaluation-metrics.mjs";

const supportedRules = new Set([
  "api/exported-symbol-removed",
  "api/public-type-member-removed",
  "api/public-signature-changed",
  "api/public-interface-changed",
  "dependency/new-production",
  "dependency/removed",
  "dependency/version-changed",
  "scope/outside-expected-path",
  "tests/missing-related-change",
]);

/** A case scores exactly one reviewed rule on one fixed Git commit. */
export function validateEvaluationManifest(manifest) {
  if (
    manifest?.schemaVersion !== 2 ||
    typeof manifest.repositories !== "object" ||
    manifest.repositories === null ||
    !Array.isArray(manifest.cases) ||
    manifest.cases.length === 0
  ) {
    throw new Error("Unsupported external evaluation manifest");
  }

  const ids = new Set();
  for (const evaluationCase of manifest.cases) {
    if (
      typeof evaluationCase.id !== "string" ||
      !/^[a-z0-9-]+$/.test(evaluationCase.id) ||
      ids.has(evaluationCase.id) ||
      !supportedRules.has(evaluationCase.ruleId) ||
      !/^[a-z0-9-]+$/.test(evaluationCase.repository) ||
      !Object.hasOwn(manifest.repositories, evaluationCase.repository) ||
      typeof manifest.repositories[evaluationCase.repository] !== "string" ||
      !/^[0-9a-f]{40}$/.test(evaluationCase.head) ||
      !Array.isArray(evaluationCase.expected) ||
      typeof evaluationCase.reason !== "string" ||
      evaluationCase.reason.length === 0
    ) {
      throw new Error(`Invalid external evaluation case: ${evaluationCase.id ?? "unknown"}`);
    }
    compareEvaluationLabels(evaluationCase.expected, []);
    const labelField = evaluationCase.ruleId.startsWith("dependency/")
      ? "package"
      : evaluationCase.ruleId.startsWith("api/")
        ? "symbolName"
        : "file";
    if (evaluationCase.expected.some((label) => !Object.hasOwn(label, labelField))) {
      throw new Error(`Invalid ${labelField} label in case: ${evaluationCase.id}`);
    }
    if (
      (evaluationCase.ruleId.startsWith("scope/") || evaluationCase.ruleId.startsWith("tests/")) &&
      (typeof evaluationCase.contract !== "object" ||
        evaluationCase.contract === null ||
        Array.isArray(evaluationCase.contract))
    ) {
      throw new Error(`Missing contract in case: ${evaluationCase.id}`);
    }
    ids.add(evaluationCase.id);
  }
}
