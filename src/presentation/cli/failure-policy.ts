import { type Finding, isSeverityAtLeast, type Severity } from "../../domain/finding.js";

export function shouldFail(findings: readonly Finding[], threshold: Severity): boolean {
  return findings.some((finding) => isSeverityAtLeast(finding.severity, threshold));
}
