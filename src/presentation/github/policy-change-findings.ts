import { relative, sep } from "node:path";
import type { FileChange } from "../../domain/change.js";
import type { Finding } from "../../domain/finding.js";
import { resolveRepositoryPath } from "../../infrastructure/filesystem/repository-path.js";

/** PR의 검사 정책 변경을 별도 finding으로 노출해 정책 자체의 변경을 숨길 수 없게 한다. */
export function policyChangeFindings(
  workingDirectory: string,
  changedFiles: readonly FileChange[],
  configurationPath?: string,
  baselinePath?: string,
): readonly Finding[] {
  const policies = [
    { kind: "contract", path: configurationPath ?? ".intentpatch.json" },
    { kind: "baseline", path: baselinePath ?? ".intentpatch-baseline.json" },
  ];
  return policies.flatMap(({ kind, path }) => {
    const absolute = resolveRepositoryPath(workingDirectory, path);
    const repositoryPath = relative(workingDirectory, absolute).split(sep).join("/");
    const changed = changedFiles.find(
      (file) => file.path === repositoryPath || file.previousPath === repositoryPath,
    );
    if (changed === undefined) return [];
    return [
      {
        ruleId: `policy/${kind}-changed`,
        severity: "high" as const,
        title: `Review changed ${kind} policy`,
        description: `The pull request changes ${repositoryPath}, which controls its own analysis. Review and merge policy changes separately before relying on this quality gate.`,
        file: changed.path,
        evidence: { policyPath: repositoryPath, changeKind: changed.kind },
      },
    ];
  });
}
