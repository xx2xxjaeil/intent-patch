import { createHash } from "node:crypto";
import ts from "typescript";
import type {
  SourceSymbolExtractor,
  SymbolExtractionResult,
} from "../../application/ports/source-symbol-extractor.js";
import type {
  PublicApi,
  PublicApiMember,
  SourceSymbol,
  SourceSymbolKind,
} from "../../domain/symbol-change.js";
import { parseTypeScriptSource } from "./parse-typescript-source.js";

interface SymbolGroup {
  readonly name: string;
  readonly kind: SourceSymbolKind;
  readonly line: number;
  readonly declarations: string[];
  readonly statements: ts.Statement[];
  exported: boolean;
}

/** TypeScript Compiler API로 이름이 있는 최상위 선언과 공개 계약을 추출한다. */
export class TypeScriptSymbolExtractor implements SourceSymbolExtractor {
  public supports(path: string): boolean {
    return path.endsWith(".ts") || path.endsWith(".tsx");
  }

  public extract(path: string, source: string): SymbolExtractionResult {
    const parseResult = parseTypeScriptSource(path, source);
    if (parseResult.kind === "unavailable") {
      return parseResult;
    }
    const { sourceFile } = parseResult;
    const localExports = collectLocalExports(sourceFile);
    const localTypeAliases = collectLocalTypeAliases(sourceFile);
    const groups = new Map<string, SymbolGroup>();

    for (const statement of sourceFile.statements) {
      const identity = declarationIdentity(statement);
      if (identity === undefined) {
        continue;
      }

      const key = `${identity.kind}\0${identity.name}`;
      const existing = groups.get(key);
      const text = statement.getText(sourceFile);
      const exported = hasExportModifier(statement) || localExports.has(identity.name);
      if (existing === undefined) {
        const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
        groups.set(key, {
          ...identity,
          line: position.line + 1,
          declarations: [text],
          statements: [statement],
          exported,
        });
      } else {
        existing.declarations.push(text);
        existing.statements.push(statement);
        existing.exported ||= exported;
      }
    }

    collectExternalReExports(sourceFile, groups);

    const symbols = [...groups.values()]
      .flatMap((group) => [
        toSourceSymbol(group, sourceFile, localTypeAliases),
        ...classMethodSymbols(group, sourceFile),
      ])
      .sort(
        (left, right) =>
          left.line - right.line ||
          left.kind.localeCompare(right.kind) ||
          left.name.localeCompare(right.name),
      );
    return { kind: "success", symbols };
  }
}

function collectLocalTypeAliases(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ts.TypeAliasDeclaration> {
  const aliases = new Map<string, ts.TypeAliasDeclaration>();
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      aliases.set(statement.name.text, statement);
    }
  }
  return aliases;
}

function collectLocalExports(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier !== undefined ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      names.add((element.propertyName ?? element.name).text);
    }
  }
  return names;
}

function collectExternalReExports(
  sourceFile: ts.SourceFile,
  groups: Map<string, SymbolGroup>,
): void {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.getText(sourceFile);
    for (const name of reExportNames(statement, moduleName)) {
      const key = `re-export\0${name}`;
      const text = statement.getText(sourceFile);
      const existing = groups.get(key);
      if (existing === undefined) {
        const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
        groups.set(key, {
          name,
          kind: "re-export",
          line: position.line + 1,
          declarations: [text],
          statements: [statement],
          exported: true,
        });
      } else {
        existing.declarations.push(text);
        existing.statements.push(statement);
      }
    }
  }
}

function reExportNames(statement: ts.ExportDeclaration, moduleName: string): readonly string[] {
  if (statement.exportClause === undefined) {
    return [`* from ${moduleName}`];
  }
  if (ts.isNamespaceExport(statement.exportClause)) {
    return [statement.exportClause.name.text];
  }
  return statement.exportClause.elements.map((element) => element.name.text);
}

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}

function declarationIdentity(
  statement: ts.Statement,
): Readonly<{ name: string; kind: SourceSymbolKind }> | undefined {
  if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
    return { name: statement.name.text, kind: "function" };
  }
  if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
    return { name: statement.name.text, kind: "class" };
  }
  if (ts.isEnumDeclaration(statement)) {
    return { name: statement.name.text, kind: "enum" };
  }
  if (ts.isInterfaceDeclaration(statement)) {
    return { name: statement.name.text, kind: "interface" };
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    return { name: statement.name.text, kind: "type-alias" };
  }
  return undefined;
}

/** 정적 이름을 가진 메서드만 별도 심볼로 기록한다. 공개 클래스의 private/protected 메서드는 공개 API가 아니다. */
function classMethodSymbols(group: SymbolGroup, sourceFile: ts.SourceFile): SourceSymbol[] {
  if (group.kind !== "class") return [];
  const methods = new Map<string, { line: number; exported: boolean; declarations: string[] }>();
  for (const declaration of group.statements.filter(ts.isClassDeclaration)) {
    for (const member of declaration.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const name = staticClassMemberName(member.name);
      if (name === undefined) continue;
      const modifiers = ts.getModifiers(member) ?? [];
      const isStatic = modifiers.some((item) => item.kind === ts.SyntaxKind.StaticKeyword);
      const isPrivate = modifiers.some(
        (item) =>
          item.kind === ts.SyntaxKind.PrivateKeyword ||
          item.kind === ts.SyntaxKind.ProtectedKeyword,
      );
      const symbolName = `${group.name}${isStatic ? ".static" : ""}.${name}`;
      const existing = methods.get(symbolName);
      if (existing === undefined) {
        methods.set(symbolName, {
          line: sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1,
          exported: group.exported && !isPrivate,
          declarations: [member.getText(sourceFile)],
        });
      } else {
        existing.declarations.push(member.getText(sourceFile));
      }
    }
  }
  return [...methods].map(([name, method]) => ({
    name,
    kind: "method",
    line: method.line,
    exported: method.exported,
    fingerprint: createHash("sha256").update(method.declarations.join("\0")).digest("hex"),
  }));
}

function staticClassMemberName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

function toSourceSymbol(
  group: SymbolGroup,
  sourceFile: ts.SourceFile,
  localTypeAliases: ReadonlyMap<string, ts.TypeAliasDeclaration>,
): SourceSymbol {
  const publicApi = group.exported
    ? extractPublicApi(group, sourceFile, localTypeAliases)
    : undefined;
  return {
    name: group.name,
    kind: group.kind,
    line: group.line,
    exported: group.exported,
    // 로컬 타입 별칭을 참조하는 공개 타입은 선언문이 그대로여도 계약이 달라질 수 있다.
    fingerprint: createHash("sha256")
      .update(group.declarations.join("\0"))
      .update("\0")
      .update(JSON.stringify(publicApi) ?? "")
      .digest("hex"),
    ...(publicApi === undefined ? {} : { publicApi }),
  };
}

function extractPublicApi(
  group: SymbolGroup,
  sourceFile: ts.SourceFile,
  localTypeAliases: ReadonlyMap<string, ts.TypeAliasDeclaration>,
): PublicApi | undefined {
  if (group.kind === "function") {
    const declarations = group.statements.filter(ts.isFunctionDeclaration);
    const overloads = declarations.filter((declaration) => declaration.body === undefined);
    const publicDeclarations = overloads.length > 0 ? overloads : declarations;
    return {
      kind: "function",
      signatures: publicDeclarations
        .map((declaration) => functionSignature(declaration, sourceFile))
        .sort(),
    };
  }
  if (group.kind === "interface") {
    const declarations = group.statements.filter(ts.isInterfaceDeclaration);
    return {
      kind: "interface",
      extendsTypes: declarations
        .flatMap(
          (declaration) =>
            declaration.heritageClauses?.flatMap((clause) =>
              clause.types.map((type) => normalize(type.getText(sourceFile))),
            ) ?? [],
        )
        .sort(),
      members: declarations
        .flatMap((declaration) =>
          declaration.members.flatMap((member) => publicApiMember(member, sourceFile)),
        )
        .sort(comparePublicApiMembers),
    };
  }
  if (group.kind === "type-alias") {
    const declaration = group.statements.find(ts.isTypeAliasDeclaration);
    if (declaration === undefined) return undefined;
    const members = resolveTypeAliasMembers(
      declaration.type,
      sourceFile,
      localTypeAliases,
      new Set([declaration.name.text]),
    );
    return members === undefined
      ? undefined
      : { kind: "type-alias", members: [...members].sort(comparePublicApiMembers) };
  }
  return undefined;
}

/** 완전히 해석 가능한 객체 리터럴과 같은 파일의 교집합만 추적한다. */
function resolveTypeAliasMembers(
  type: ts.TypeNode,
  sourceFile: ts.SourceFile,
  localTypeAliases: ReadonlyMap<string, ts.TypeAliasDeclaration>,
  visited: ReadonlySet<string>,
): readonly PublicApiMember[] | undefined {
  if (ts.isParenthesizedTypeNode(type)) {
    return resolveTypeAliasMembers(type.type, sourceFile, localTypeAliases, visited);
  }
  if (ts.isTypeLiteralNode(type)) {
    const members = type.members.map((member) => publicApiMember(member, sourceFile));
    return members.some((member) => member.length !== 1) ? undefined : members.flat();
  }
  if (ts.isIntersectionTypeNode(type)) {
    const members = type.types.map((part) =>
      resolveTypeAliasMembers(part, sourceFile, localTypeAliases, visited),
    );
    return members.some((part) => part === undefined)
      ? undefined
      : members.flatMap((part) => part ?? []);
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text;
    const alias = localTypeAliases.get(name);
    if (
      alias === undefined ||
      visited.has(name) ||
      alias.typeParameters !== undefined ||
      type.typeArguments !== undefined
    ) {
      return undefined;
    }
    return resolveTypeAliasMembers(
      alias.type,
      sourceFile,
      localTypeAliases,
      new Set([...visited, name]),
    );
  }
  return undefined;
}

function functionSignature(
  declaration: ts.FunctionDeclaration | ts.MethodSignature,
  sourceFile: ts.SourceFile,
): string {
  const typeParameters = declaration.typeParameters?.map((parameter) =>
    normalize(parameter.getText(sourceFile)),
  );
  const generics = typeParameters === undefined ? "" : `<${typeParameters.join(",")}>`;
  const parameters = declaration.parameters
    .map((parameter) => parameterSignature(parameter, sourceFile))
    .join(",");
  const returnType = declaration.type?.getText(sourceFile) ?? "inferred";
  return `${generics}(${parameters}):${normalize(returnType)}`;
}

function parameterSignature(parameter: ts.ParameterDeclaration, sourceFile: ts.SourceFile): string {
  const rest = parameter.dotDotDotToken === undefined ? "" : "...";
  const optional =
    parameter.questionToken !== undefined || parameter.initializer !== undefined ? "?" : "";
  const type = parameter.type?.getText(sourceFile) ?? "inferred";
  return `${rest}${normalize(type)}${optional}`;
}

function publicApiMember(
  member: ts.TypeElement,
  sourceFile: ts.SourceFile,
): readonly PublicApiMember[] {
  if (ts.isPropertySignature(member) && member.name !== undefined) {
    const name = staticMemberName(member.name);
    if (name === undefined) return [];
    return [
      {
        name,
        memberKind: "property",
        optional: member.questionToken !== undefined,
        signature: normalize(member.type?.getText(sourceFile) ?? "inferred"),
      },
    ];
  }
  if (ts.isMethodSignature(member)) {
    const name = staticMemberName(member.name);
    if (name === undefined) return [];
    return [
      {
        name,
        memberKind: "method",
        optional: member.questionToken !== undefined,
        signature: functionSignature(member, sourceFile),
      },
    ];
  }
  return [];
}

function staticMemberName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function comparePublicApiMembers(left: PublicApiMember, right: PublicApiMember): number {
  return left.name.localeCompare(right.name) || left.memberKind.localeCompare(right.memberKind);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
