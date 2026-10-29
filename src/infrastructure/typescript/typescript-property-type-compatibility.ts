import ts from "typescript";
import type { PropertyTypeCompatibility } from "../../application/ports/property-type-compatibility.js";

/** 자체적으로 해석 가능한 객체 타입에서 선택 필드만 추가된 경우에 한해 호환성을 인정한다. */
export class TypeScriptPropertyTypeCompatibility implements PropertyTypeCompatibility {
  public preservesOptionalObjectExtensions(previous: string, current: string): boolean {
    const source = ts.createSourceFile(
      "intentpatch-property-compatibility.ts",
      `type Previous = ${previous};\ntype Current = ${current};`,
      ts.ScriptTarget.Latest,
      true,
    );
    const declarations = source.statements.filter(ts.isTypeAliasDeclaration);
    return (
      source.statements.length === 2 &&
      declarations.length === 2 &&
      declarations[0] !== undefined &&
      declarations[1] !== undefined &&
      preservesType(declarations[0].type, declarations[1].type, source)
    );
  }
}

function preservesType(
  previous: ts.TypeNode,
  current: ts.TypeNode,
  source: ts.SourceFile,
): boolean {
  if (normalized(previous, source) === normalized(current, source)) return true;
  if (ts.isParenthesizedTypeNode(previous) && ts.isParenthesizedTypeNode(current)) {
    return preservesType(previous.type, current.type, source);
  }
  if (isReadonlyWrapper(previous) && isReadonlyWrapper(current)) {
    const previousArgument = previous.typeArguments?.[0];
    const currentArgument = current.typeArguments?.[0];
    return (
      previousArgument !== undefined &&
      currentArgument !== undefined &&
      preservesType(previousArgument, currentArgument, source)
    );
  }
  if (!ts.isTypeLiteralNode(previous) || !ts.isTypeLiteralNode(current)) return false;

  const previousMembers = propertyMembers(previous);
  const currentMembers = propertyMembers(current);
  if (previousMembers === undefined || currentMembers === undefined) return false;

  for (const [name, member] of previousMembers) {
    const next = currentMembers.get(name);
    if (
      next === undefined ||
      Boolean(member.questionToken) !== Boolean(next.questionToken) ||
      isReadonly(member) !== isReadonly(next) ||
      member.type === undefined ||
      next.type === undefined ||
      !preservesType(member.type, next.type, source)
    ) {
      return false;
    }
  }
  return [...currentMembers].every(
    ([name, member]) => previousMembers.has(name) || member.questionToken !== undefined,
  );
}

function propertyMembers(
  literal: ts.TypeLiteralNode,
): ReadonlyMap<string, ts.PropertySignature> | undefined {
  const members = new Map<string, ts.PropertySignature>();
  for (const member of literal.members) {
    if (!ts.isPropertySignature(member) || member.name === undefined) return undefined;
    const name =
      ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
        ? member.name.text
        : undefined;
    if (name === undefined || members.has(name)) return undefined;
    members.set(name, member);
  }
  return members;
}

function isReadonlyWrapper(type: ts.TypeNode): type is ts.TypeReferenceNode {
  return (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "Readonly" &&
    type.typeArguments?.length === 1
  );
}

function isReadonly(member: ts.PropertySignature): boolean {
  return (
    member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false
  );
}

function normalized(type: ts.TypeNode, source: ts.SourceFile): string {
  return type.getText(source).replace(/\s+/gu, " ").trim();
}
