/** 검토 안내는 분석 결과가 아니라, 규칙 ID에 대응하는 고정된 확인 절차다. */
export interface ReviewGuide {
  readonly verify: string;
  readonly caveat: string;
}

export function reviewGuideForRule(ruleId: string): ReviewGuide {
  if (ruleId.startsWith("api/")) {
    return {
      verify:
        "Check the previous public entrypoint and update or test every known consumer of the changed API.",
      caveat:
        "Export evidence and supported type checks cannot prove whole-project or runtime compatibility.",
    };
  }
  if (ruleId === "dependency/no-static-reference") {
    return {
      verify:
        "Search configuration, scripts, CLI usage, and dynamic loading before deciding whether this package is needed.",
      caveat:
        "No static source reference is a review candidate, not proof that the dependency is unused.",
    };
  }
  if (ruleId.includes("invalid-") || ruleId.includes("unsupported-")) {
    return {
      verify:
        "Inspect the named manifest or lockfile and confirm its format before relying on dependency results.",
      caveat:
        "An unreadable or unsupported file leaves part of the dependency analysis unavailable.",
    };
  }
  if (ruleId.startsWith("dependency/")) {
    return {
      verify:
        "Check why the package or resolved version changed, then review compatibility and existing alternatives.",
      caveat: "A dependency change alone does not show that the package is unnecessary or unsafe.",
    };
  }
  if (ruleId.startsWith("scope/")) {
    return {
      verify:
        "Compare this change with the original request and the reviewed Change Contract before accepting the scope.",
      caveat:
        "Declared paths and budgets express reviewer expectations, not inferred intent or correctness.",
    };
  }
  if (ruleId.startsWith("tests/")) {
    return {
      verify:
        "Find the relevant tests, run them, and check whether the changed behavior has an assertion.",
      caveat:
        "Changed test paths are a relationship signal; IntentPatch does not execute tests or measure coverage.",
    };
  }
  if (ruleId === "structure/duplicate-implementation") {
    return {
      verify:
        "Compare the two implementations and their callers before reusing or consolidating code.",
      caveat:
        "Matching normalized tokens do not prove that the implementations have the same behavior.",
    };
  }
  if (ruleId === "structure/single-implementation-abstraction") {
    return {
      verify:
        "Check whether a real second implementation or stable extension boundary justifies the new interface.",
      caveat:
        "One implementation can still be intentional; this rule is an abstraction review prompt.",
    };
  }
  if (ruleId.startsWith("policy/")) {
    return {
      verify:
        "Review the policy change separately from the code change before trusting this run's quality gate.",
      caveat:
        "This finding detects a policy-file change; it does not establish whether the new policy is safe.",
    };
  }
  return {
    verify:
      "Inspect the listed evidence and the relevant diff before deciding whether action is needed.",
    caveat: "A finding is a review signal, not proof that the implementation is wrong.",
  };
}
