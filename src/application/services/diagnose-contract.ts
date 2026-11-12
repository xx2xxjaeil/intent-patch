import type { ChangeContract } from "../../domain/change-contract.js";

export interface CheckReadiness {
  readonly label: string;
  readonly enabled: boolean;
  readonly detail: string;
}

/** 계약에 따라 실제로 활성화될 규칙만 표시한다. 코드 분석 성공 여부와는 별개다. */
export function diagnoseContract(contract: ChangeContract | undefined): readonly CheckReadiness[] {
  const scope = contract?.scope;
  return [
    {
      label: "Git, dependency, JS/TS analysis",
      enabled: true,
      detail: "Runs on supported files; analyze reports any unavailable inputs.",
    },
    {
      label: "Expected scope",
      enabled: (scope?.include.length ?? 0) > 0,
      detail:
        (scope?.include.length ?? 0) > 0
          ? `${scope?.include.length} expected path pattern(s); ${scope?.allow.length ?? 0} allowed exception(s).`
          : "Set scope.include in the Change Contract to check unexpected paths.",
    },
    {
      label: "Change budgets",
      enabled: scope?.maxFiles !== undefined || scope?.maxLines !== undefined,
      detail:
        scope?.maxFiles === undefined && scope?.maxLines === undefined
          ? "Set scope.maxFiles or scope.maxLines to check change size."
          : [
              scope.maxFiles === undefined ? undefined : `${scope.maxFiles} files`,
              scope.maxLines === undefined ? undefined : `${scope.maxLines} measured lines`,
            ]
              .filter((value): value is string => value !== undefined)
              .join(", "),
    },
    {
      label: "Related test changes",
      enabled: contract?.tests !== undefined,
      detail:
        contract?.tests === undefined
          ? "Set tests.requireFor and tests.include together to check changed tests."
          : `${contract.tests.requireFor.length} source pattern(s); ${contract.tests.include.length} test pattern(s). Tests are not executed.`,
    },
  ];
}
