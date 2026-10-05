import ts from "typescript";
import type {
  ModuleReferenceExtractionResult,
  ModuleReferenceExtractor,
} from "../../application/ports/module-reference-extractor.js";
import { parseTypeScriptSource } from "./parse-typescript-source.js";

/** TypeScript AST에서 빌드 시점에 결정되는 정적 module specifier만 추출한다. */
export class TypeScriptModuleReferenceExtractor implements ModuleReferenceExtractor {
  public supports(path: string): boolean {
    return path.endsWith(".ts") || path.endsWith(".tsx");
  }

  public extract(path: string, source: string): ModuleReferenceExtractionResult {
    const parseResult = parseTypeScriptSource(path, source);
    if (parseResult.kind === "unavailable") {
      return parseResult;
    }

    const specifiers = new Set<string>();
    for (const statement of parseResult.sourceFile.statements) {
      const specifier = moduleSpecifier(statement);
      if (specifier !== undefined) {
        specifiers.add(specifier);
      }
    }

    return { kind: "success", specifiers: [...specifiers].sort() };
  }
}

function moduleSpecifier(statement: ts.Statement): string | undefined {
  if (
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(statement.moduleSpecifier)
  ) {
    return statement.moduleSpecifier.text;
  }

  if (
    ts.isImportEqualsDeclaration(statement) &&
    ts.isExternalModuleReference(statement.moduleReference) &&
    statement.moduleReference.expression !== undefined &&
    ts.isStringLiteralLike(statement.moduleReference.expression)
  ) {
    return statement.moduleReference.expression.text;
  }

  return undefined;
}
