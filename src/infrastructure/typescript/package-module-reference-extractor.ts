import ts from "typescript";
import type {
  ModuleReferenceExtractionResult,
  ModuleReferenceExtractor,
} from "../../application/ports/module-reference-extractor.js";

const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/u;

/** JS/TS AST에서 명시적 import, re-export, require와 동적 import의 문자열 인자를 수집한다. */
export class PackageModuleReferenceExtractor implements ModuleReferenceExtractor {
  public supports(path: string): boolean {
    return sourceExtension.test(path);
  }

  public extract(path: string, source: string): ModuleReferenceExtractionResult {
    const result = ts.transpileModule(source, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.ReactJSX },
    });
    const error = result.diagnostics?.find(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (error !== undefined) {
      return {
        kind: "unavailable",
        reason: ts.flattenDiagnosticMessageText(error.messageText, " "),
      };
    }

    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(path),
    );
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
    visit(sourceFile);
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

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(?:c|m)?js$/u.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
