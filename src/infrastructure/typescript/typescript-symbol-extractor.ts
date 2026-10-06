import { createHash } from "node:crypto";
import ts from "typescript";
import type {
  SourceSymbolExtractor,
  SymbolExtractionResult,
} from "../../application/ports/source-symbol-extractor.js";
import type {
  InterfacePublicApiMember,
  PublicApi,
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
      .map((group) => toSourceSymbol(group, sourceFile))
      .sort(
        (left, right) =>
          left.line - right.line ||
          left.kind.localeCompare(right.kind) ||
          left.name.localeCompare(right.name),
      );
    return { kind: "success", symbols };
  }
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
  if (ts.isInterfaceDeclaration(statement)) {
    return { name: statement.name.text, kind: "interface" };
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    return { name: statement.name.text, kind: "type-alias" };
  }
  return undefined;
}

function toSourceSymbol(group: SymbolGroup, sourceFile: ts.SourceFile): SourceSymbol {
  const publicApi = group.exported ? extractPublicApi(group, sourceFile) : undefined;
  return {
    name: group.name,
    kind: group.kind,
    line: group.line,
    exported: group.exported,
    fingerprint: createHash("sha256").update(group.declarations.join("\0")).digest("hex"),
    ...(publicApi === undefined ? {} : { publicApi }),
  };
}

function extractPublicApi(group: SymbolGroup, sourceFile: ts.SourceFile): PublicApi | undefined {
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
          declaration.members.flatMap((member) => interfaceMember(member, sourceFile)),
        )
        .sort(compareInterfaceMembers),
    };
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

function interfaceMember(
  member: ts.TypeElement,
  sourceFile: ts.SourceFile,
): readonly InterfacePublicApiMember[] {
  if (ts.isPropertySignature(member) && member.name !== undefined) {
    return [
      {
        name: normalize(member.name.getText(sourceFile)),
        memberKind: "property",
        optional: member.questionToken !== undefined,
        signature: normalize(member.type?.getText(sourceFile) ?? "inferred"),
      },
    ];
  }
  if (ts.isMethodSignature(member)) {
    return [
      {
        name: normalize(member.name.getText(sourceFile)),
        memberKind: "method",
        optional: member.questionToken !== undefined,
        signature: functionSignature(member, sourceFile),
      },
    ];
  }
  return [];
}

function compareInterfaceMembers(
  left: InterfacePublicApiMember,
  right: InterfacePublicApiMember,
): number {
  return left.name.localeCompare(right.name) || left.memberKind.localeCompare(right.memberKind);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
