function labelKey(label) {
  if (
    typeof label?.file !== "string" ||
    label.file.length === 0 ||
    typeof label.symbolName !== "string" ||
    label.symbolName.length === 0
  ) {
    throw new Error("Evaluation labels require a file and symbolName");
  }
  return `${label.file}\0${label.symbolName}`;
}

function indexLabels(labels, description) {
  const indexed = new Map();
  for (const label of labels) {
    const key = labelKey(label);
    if (indexed.has(key)) {
      throw new Error(`Duplicate ${description} label: ${label.file} ${label.symbolName}`);
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
