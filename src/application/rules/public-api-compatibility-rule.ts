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

/** 공개 함수·인터페이스 계약과 공개 객체 타입의 구성원 삭제를 찾는다. */
export class PublicApiCompatibilityRule implements AnalysisRule {
  public constructor(private readonly signatureCompatibility: FunctionSignatureCompatibility) {}

  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    return (context.symbolChanges?.changes ?? []).flatMap((change) =>
      toFinding(change, this.signatureCompatibility),
    );
  }
}

function toFinding(
  change: SymbolChange,
  signatureCompatibility: FunctionSignatureCompatibility,
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
    return interfaceFinding(change, change.beforePublicApi, change.afterPublicApi);
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
): Finding[] {
  const reasons = interfaceBreakingReasons(before, after);
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
): readonly string[] {
  const reasons: string[] = [];
  if (!sameValues(before.extendsTypes, after.extendsTypes)) {
    reasons.push("extended types changed");
  }

  const currentMembers = new Set(after.members.map(memberContract));
  for (const member of before.members) {
    if (!currentMembers.has(memberContract(member))) {
      reasons.push(`member removed or changed: ${member.name}`);
    }
  }

  const previousMembers = new Set(before.members.map(memberContract));
  for (const member of after.members) {
    if (!member.optional && !previousMembers.has(memberContract(member))) {
      reasons.push(`required member added or changed: ${member.name}`);
    }
  }

  return [...new Set(reasons)].sort();
}

function memberContract(member: PublicApiMember): string {
  return [member.memberKind, member.name, member.optional, member.signature].join("\0");
}

function memberIdentity(member: PublicApiMember): string {
  return [member.memberKind, member.name].join("\0");
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
