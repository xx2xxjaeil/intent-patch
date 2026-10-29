function labelKey(label) {
  const name = label?.symbolName ?? label?.package;
  if (
    typeof label?.file !== "string" ||
    label.file.length === 0 ||
    (name !== undefined && (typeof name !== "string" || name.length === 0)) ||
    (label.symbolName !== undefined && label.package !== undefined)
  ) {
    throw new Error("Evaluation labels require a file and at most one symbolName or package");
  }
  const kind =
    label.symbolName === undefined ? (label.package === undefined ? "file" : "package") : "symbol";
  return `${label.file}\0${kind}\0${name ?? ""}`;
}

function indexLabels(labels, description) {
  const indexed = new Map();
  for (const label of labels) {
    const key = labelKey(label);
    if (indexed.has(key)) {
      throw new Error(
        `Duplicate ${description} label: ${label.file} ${label.symbolName ?? label.package}`,
      );
    }
    indexed.set(key, label);
  }
  return indexed;
}

/** Compare one rule's reviewed labels with its actual findings, without scoring other rules. */
export function compareEvaluationLabels(expected, actual) {
  const expectedByKey = indexLabels(expected, "expected");
  const actualByKey = indexLabels(actual, "actual");
  return {
    matched: expected.filter((label) => actualByKey.has(labelKey(label))),
    missing: expected.filter((label) => !actualByKey.has(labelKey(label))),
    unexpected: actual.filter((label) => !expectedByKey.has(labelKey(label))),
  };
}

export function summarizeEvaluation(results) {
  return results.reduce(
    (total, result) => ({
      matched: total.matched + result.matched.length,
      missing: total.missing + result.missing.length,
      unexpected: total.unexpected + result.unexpected.length,
    }),
    { matched: 0, missing: 0, unexpected: 0 },
  );
}

/** Keep reviewed-label agreement visible per rule instead of hiding it in one total. */
export function summarizeEvaluationByRule(results) {
  const byRule = {};
  for (const result of results) {
    const current = byRule[result.ruleId] ?? {
      cases: 0,
      matched: 0,
      missing: 0,
      unexpected: 0,
    };
    byRule[result.ruleId] = {
      cases: current.cases + 1,
      matched: current.matched + result.matched.length,
      missing: current.missing + result.missing.length,
      unexpected: current.unexpected + result.unexpected.length,
    };
  }
  return byRule;
}
