import ts from "typescript";
import type {
  ModuleReferenceExtractionResult,
  ModuleReferenceExtractor,
} from "../../application/ports/module-reference-extractor.js";
import { parseTypeScriptSource } from "./parse-typescript-source.js";

const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/u;

/** JS/TS 소스의 문자열 기반 import, re-export, require 참조를 한 번에 수집한다. */
export class SourceModuleReferenceExtractor implements ModuleReferenceExtractor {
  public supports(path: string): boolean {
    return sourceExtension.test(path);
  }

  public extract(path: string, source: string): ModuleReferenceExtractionResult {
    const parsed = parseTypeScriptSource(path, source);
    if (parsed.kind === "unavailable") return parsed;

    const specifiers = new Set<string>();
    let hasDynamicSpecifier = false;
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        specifiers.add(node.moduleSpecifier.text);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression !== undefined &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      ) {
        specifiers.add(node.moduleReference.expression.text);
      } else if (ts.isCallExpression(node) && isModuleLoad(node.expression)) {
        const argument = node.arguments[0];
        if (argument !== undefined && ts.isStringLiteralLike(argument)) {
          specifiers.add(argument.text);
        } else {
          hasDynamicSpecifier = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed.sourceFile);
    return { kind: "success", specifiers: [...specifiers].sort(), hasDynamicSpecifier };
  }
}

function isModuleLoad(expression: ts.LeftHandSideExpression): boolean {
  return (
    expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(expression) && expression.text === "require") ||
    (ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "require" &&
      expression.name.text === "resolve")
  );
}
