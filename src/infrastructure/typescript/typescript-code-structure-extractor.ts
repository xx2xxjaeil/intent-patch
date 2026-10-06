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
    return path.endsWith(".ts") || path.endsWith(".tsx");
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
        const implementation = fingerprintImplementation(statement.body, sourceFile);
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
): Readonly<{ implementationFingerprint: string; tokenCount: number }> {
  const scanner = ts.createScanner(
    sourceFile.languageVersion,
    true,
    sourceFile.languageVariant,
    body.getText(sourceFile),
  );
  const tokens: string[] = [];

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    tokens.push(`${token}:${scanner.getTokenText()}`);
  }

  return {
    implementationFingerprint: createHash("sha256").update(tokens.join("\0")).digest("hex"),
    tokenCount: tokens.length,
  };
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
