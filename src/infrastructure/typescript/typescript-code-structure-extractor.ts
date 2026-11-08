import { createHash } from "node:crypto";
import ts from "typescript";
import type {
  ClassImplementationFact,
  CodeStructureExtractionResult,
  CodeStructureExtractor,
  FunctionImplementationFact,
  InterfaceDeclarationFact,
} from "../../application/ports/code-structure-extractor.js";
import { parseTypeScriptSource } from "./parse-typescript-source.js";

/** TypeScript AST에서 구현 중복과 단일 구현 추론에 필요한 사실만 추출한다. */
export class TypeScriptCodeStructureExtractor implements CodeStructureExtractor {
  public supports(path: string): boolean {
    return /\.(?:[cm]?[jt]s|[jt]sx)$/u.test(path);
  }

  public extract(path: string, source: string): CodeStructureExtractionResult {
    const parseResult = parseTypeScriptSource(path, source);
    if (parseResult.kind === "unavailable") {
      return parseResult;
    }

    const functions: FunctionImplementationFact[] = [];
    const interfaces = new Map<string, InterfaceDeclarationFact>();
    const classes = new Map<string, ClassImplementationFact>();
    const { sourceFile } = parseResult;

    for (const statement of sourceFile.statements) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name !== undefined &&
        statement.body !== undefined
      ) {
        const implementation = fingerprintImplementation(
          statement.body,
          sourceFile,
          statement.parameters,
        );
        functions.push({ name: statement.name.text, line, ...implementation });
        continue;
      }
      if (ts.isInterfaceDeclaration(statement) && !interfaces.has(statement.name.text)) {
        interfaces.set(statement.name.text, { name: statement.name.text, line });
        continue;
      }
      if (
        ts.isClassDeclaration(statement) &&
        statement.name !== undefined &&
        !classes.has(statement.name.text)
      ) {
        classes.set(statement.name.text, {
          name: statement.name.text,
          line,
          implementedTypes: implementedTypeNames(statement),
        });
        for (const member of statement.members) {
          if (!ts.isMethodDeclaration(member) || member.body === undefined) continue;
          const methodName = staticMethodName(member.name);
          if (methodName === undefined) continue;
          const isStatic = (ts.getModifiers(member) ?? []).some(
            (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword,
          );
          functions.push({
            name: `${statement.name.text}${isStatic ? ".static" : ""}.${methodName}`,
            line: sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1,
            symbolKind: "method",
            ...fingerprintImplementation(member.body, sourceFile, member.parameters),
          });
        }
      }
    }

    return {
      kind: "success",
      facts: {
        functions: functions.sort(compareFacts),
        interfaces: [...interfaces.values()].sort(compareFacts),
        classes: [...classes.values()].sort(compareFacts),
      },
    };
  }
}

function fingerprintImplementation(
  body: ts.Block,
  sourceFile: ts.SourceFile,
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
): Readonly<{
  implementationFingerprint: string;
  structuralFingerprint?: string;
  tokenCount: number;
}> {
  const substitutions = localIdentifierSubstitutions(body, parameters, sourceFile);
  const scanner = ts.createScanner(
    sourceFile.languageVersion,
    true,
    sourceFile.languageVariant,
    body.getText(sourceFile),
  );
  const tokens: string[] = [];
  const structuralTokens: string[] = [];

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const value = scanner.getTokenText();
    tokens.push(`${token}:${value}`);
    structuralTokens.push(`${token}:${substitutions?.get(scanner.getTokenPos()) ?? value}`);
  }

  return {
    implementationFingerprint: createHash("sha256").update(tokens.join("\0")).digest("hex"),
    ...(substitutions === undefined
      ? {}
      : {
          structuralFingerprint: createHash("sha256")
            .update(structuralTokens.join("\0"))
            .digest("hex"),
        }),
    tokenCount: tokens.length,
  };
}

/** 매개변수·지역 변수의 참조만 치환한다. 중첩 스코프와 구조 분해는 추정하지 않는다. */
function localIdentifierSubstitutions(
  body: ts.Block,
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  sourceFile: ts.SourceFile,
): ReadonlyMap<number, string> | undefined {
  const names: string[] = [];
  for (const parameter of parameters) {
    if (!ts.isIdentifier(parameter.name)) return undefined;
    names.push(parameter.name.text);
  }
  let supported = true;
  const collect = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) {
      supported = false;
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      if (!ts.isIdentifier(node.name)) supported = false;
      else names.push(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(body);
  if (!supported || new Set(names).size !== names.length) return undefined;

  // NUL 접두사는 실제 식별자와 충돌하지 않아 외부 호출명을 지역 변수로 오인하지 않는다.
  const canonical = new Map(names.map((name, index) => [name, `\0local${index}`]));
  const substitutions = new Map<number, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && canonical.has(node.text) && !isPropertyName(node)) {
      substitutions.set(
        node.getStart(sourceFile) - body.getStart(sourceFile),
        canonical.get(node.text) ?? "",
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return substitutions;
}

function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isShorthandPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isLabeledStatement(parent) && parent.label === node)
  );
}

function staticMethodName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

function implementedTypeNames(declaration: ts.ClassDeclaration): readonly string[] {
  const names =
    declaration.heritageClauses
      ?.filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
      .flatMap((clause) => clause.types.map((type) => simpleExpressionName(type.expression))) ?? [];
  return [...new Set(names)].sort();
}

function simpleExpressionName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return expression.getText();
}

function compareFacts(
  left: Readonly<{ name: string; line: number }>,
  right: Readonly<{ name: string; line: number }>,
): number {
  return left.line - right.line || left.name.localeCompare(right.name);
}
