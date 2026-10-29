import type { Finding } from "../../domain/finding.js";
import type {
  FunctionPublicApi,
  InterfacePublicApi,
  PublicApiMember,
  SymbolChange,
  TypeAliasPublicApi,
} from "../../domain/symbol-change.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import type { FunctionSignatureCompatibility } from "../ports/function-signature-compatibility.js";
import type { PropertyTypeCompatibility } from "../ports/property-type-compatibility.js";

/** 공개 함수·인터페이스 계약과 공개 객체 타입의 구성원 삭제를 찾는다. */
export class PublicApiCompatibilityRule implements AnalysisRule {
  public constructor(
    private readonly signatureCompatibility: FunctionSignatureCompatibility,
    private readonly propertyTypeCompatibility: PropertyTypeCompatibility,
  ) {}

  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    return (context.symbolChanges?.changes ?? []).flatMap((change) =>
      toFinding(change, this.signatureCompatibility, this.propertyTypeCompatibility),
    );
  }
}

function toFinding(
  change: SymbolChange,
  signatureCompatibility: FunctionSignatureCompatibility,
  propertyTypeCompatibility: PropertyTypeCompatibility,
): Finding[] {
  if (
    change.changeKind !== "modified" ||
    change.beforePubliclyReachable === false ||
    change.beforeExported !== true ||
    change.afterExported !== true ||
    change.beforePublicApi === undefined ||
    change.afterPublicApi === undefined ||
    change.beforePublicApi.kind !== change.afterPublicApi.kind
  ) {
    return [];
  }

  if (change.beforePublicApi.kind === "function" && change.afterPublicApi.kind === "function") {
    return functionFinding(
      change,
      change.beforePublicApi,
      change.afterPublicApi,
      signatureCompatibility,
    );
  }
  if (change.beforePublicApi.kind === "interface" && change.afterPublicApi.kind === "interface") {
    return interfaceFinding(
      change,
      change.beforePublicApi,
      change.afterPublicApi,
      propertyTypeCompatibility,
    );
  }
  if (change.beforePublicApi.kind === "type-alias" && change.afterPublicApi.kind === "type-alias") {
    return typeAliasFinding(change, change.beforePublicApi, change.afterPublicApi);
  }
  return [];
}

function typeAliasFinding(
  change: SymbolChange,
  before: TypeAliasPublicApi,
  after: TypeAliasPublicApi,
): Finding[] {
  const currentMembers = new Set(after.members.map(memberIdentity));
  const removedMembers = [
    ...new Set(
      before.members
        .filter((member) => !currentMembers.has(memberIdentity(member)))
        .map((member) => member.name),
    ),
  ].sort();
  if (removedMembers.length === 0) return [];

  return [
    {
      ruleId: "api/public-type-member-removed",
      severity: "high",
      title: "Public type member removed",
      description: `The exported type ${change.name} no longer contains every previous member.`,
      file: change.path,
      evidence: {
        symbolName: change.name,
        removedMembers: removedMembers.join(", "),
        ...(change.afterLine === undefined ? {} : { currentLine: change.afterLine }),
      },
    },
  ];
}

function functionFinding(
  change: SymbolChange,
  before: FunctionPublicApi,
  after: FunctionPublicApi,
  signatureCompatibility: FunctionSignatureCompatibility,
): Finding[] {
  const currentSignatures = new Set(after.signatures);
  const removedSignatures = before.signatures.filter(
    (signature) => !currentSignatures.has(signature),
  );
  if (
    removedSignatures.length === 0 ||
    signatureCompatibility.preservesPreviousCalls(before.signatures, after.signatures) === true
  ) {
    return [];
  }

  return [
    {
      ruleId: "api/public-signature-changed",
      severity: "high",
      title: "Public function contract changed",
      description: `The exported function ${change.name} no longer provides every previous call signature.`,
      file: change.path,
      evidence: {
        symbolName: change.name,
        removedSignatures: removedSignatures.join(" | "),
        previousSignatures: before.signatures.join(" | "),
        currentSignatures: after.signatures.join(" | "),
        ...(change.afterLine === undefined ? {} : { currentLine: change.afterLine }),
      },
    },
  ];
}

function interfaceFinding(
  change: SymbolChange,
  before: InterfacePublicApi,
  after: InterfacePublicApi,
  propertyTypeCompatibility: PropertyTypeCompatibility,
): Finding[] {
  const reasons = interfaceBreakingReasons(before, after, propertyTypeCompatibility);
  if (reasons.length === 0) {
    return [];
  }

  return [
    {
      ruleId: "api/public-interface-changed",
      severity: "high",
      title: "Public interface contract changed",
      description: `The exported interface ${change.name} contains a backward-incompatible contract change.`,
      file: change.path,
      evidence: {
        symbolName: change.name,
        changes: reasons.join("; "),
        ...(change.afterLine === undefined ? {} : { currentLine: change.afterLine }),
      },
    },
  ];
}

function interfaceBreakingReasons(
  before: InterfacePublicApi,
  after: InterfacePublicApi,
  propertyTypeCompatibility: PropertyTypeCompatibility,
): readonly string[] {
  const reasons: string[] = [];
  if (!sameValues(before.extendsTypes, after.extendsTypes)) {
    reasons.push("extended types changed");
  }

  for (const member of before.members) {
    if (
      !after.members.some((current) => preservesMember(member, current, propertyTypeCompatibility))
    ) {
      reasons.push(`member removed or changed: ${member.name}`);
    }
  }

  for (const member of after.members) {
    if (
      !member.optional &&
      !before.members.some((previous) =>
        preservesMember(previous, member, propertyTypeCompatibility),
      )
    ) {
      reasons.push(`required member added or changed: ${member.name}`);
    }
  }

  return [...new Set(reasons)].sort();
}

function preservesMember(
  previous: PublicApiMember,
  current: PublicApiMember,
  propertyTypeCompatibility: PropertyTypeCompatibility,
): boolean {
  if (
    previous.name !== current.name ||
    previous.memberKind !== current.memberKind ||
    previous.optional !== current.optional
  )
    return false;
  return (
    previous.signature === current.signature ||
    (previous.memberKind === "method" &&
      preservesMethodCalls(previous.signature, current.signature)) ||
    (previous.memberKind === "property" &&
      propertyTypeCompatibility.preservesOptionalObjectExtensions(
        previous.signature,
        current.signature,
      ))
  );
}

/** 기존 인자·반환형을 그대로 두고 선택적 인자만 끝에 더한 메서드는 이전 호출을 수용한다. */
function preservesMethodCalls(previous: string, current: string): boolean {
  if (!previous.startsWith("(") || !current.startsWith("(")) return false;
  const previousClose = closingParenthesis(previous);
  const currentClose = closingParenthesis(current);
  if (
    previousClose === undefined ||
    currentClose === undefined ||
    previous.slice(previousClose + 1) !== current.slice(currentClose + 1)
  )
    return false;
  const previousParameters = splitParameters(previous.slice(1, previousClose));
  const currentParameters = splitParameters(current.slice(1, currentClose));
  if (
    previousParameters === undefined ||
    currentParameters === undefined ||
    currentParameters.length <= previousParameters.length
  )
    return false;
  return (
    previousParameters.every((parameter, index) => parameter === currentParameters[index]) &&
    currentParameters
      .slice(previousParameters.length)
      .every((parameter) => parameter.endsWith("?") && !parameter.startsWith("..."))
  );
}

function closingParenthesis(signature: string): number | undefined {
  let depth = 0;
  for (let index = 0; index < signature.length; index += 1) {
    if (signature[index] === "(") depth += 1;
    if (signature[index] === ")" && --depth === 0) return index;
  }
  return undefined;
}

function splitParameters(value: string): readonly string[] | undefined {
  if (value.length === 0) return [];
  const parameters: string[] = [];
  const closing = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["<", ">"],
  ]);
  const stack: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "," && stack.length === 0) {
      parameters.push(value.slice(start, index).trim());
      start = index + 1;
    } else if (character !== undefined && closing.has(character)) {
      stack.push(closing.get(character) ?? "");
    } else if (character === ")" || character === "]" || character === "}" || character === ">") {
      if (character === ">" && value[index - 1] === "=") continue;
      if (stack.pop() !== character) return undefined;
    }
  }
  if (stack.length > 0) return undefined;
  parameters.push(value.slice(start).trim());
  return parameters;
}

function memberIdentity(member: PublicApiMember): string {
  return [member.memberKind, member.name].join("\0");
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
