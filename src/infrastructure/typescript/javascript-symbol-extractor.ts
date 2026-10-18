import { createHash } from "node:crypto";
import ts from "typescript";
import type {
  SourceSymbolExtractor,
  SymbolExtractionResult,
} from "../../application/ports/source-symbol-extractor.js";
import type { SourceSymbol, SourceSymbolKind } from "../../domain/symbol-change.js";
import { parseTypeScriptSource } from "./parse-typescript-source.js";

const javaScriptExtension = /\.(?:[cm]?js|jsx)$/u;

/** JS의 확인 가능한 최상위 ESM export만 수집한다. 타입 계약은 추정하지 않는다. */
export class JavaScriptSymbolExtractor implements SourceSymbolExtractor {
  public supports(path: string): boolean {
    return javaScriptExtension.test(path);
  }

  public extract(path: string, source: string): SymbolExtractionResult {
    const parsed = parseTypeScriptSource(path, source);
    if (parsed.kind === "unavailable") return parsed;

    const { sourceFile } = parsed;
    const localExports = collectLocalNamedExports(sourceFile);
    const symbols = new Map<string, SourceSymbol>();
    const declaredNames = new Set<string>();

    for (const statement of sourceFile.statements) {
      const namedExport =
        hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
        !hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      for (const declaration of namedDeclarations(statement)) {
        declaredNames.add(declaration.name);
        addSymbol(
          symbols,
          sourceFile,
          declaration.node,
          declaration.name,
          declaration.kind,
          namedExport || localExports.has(declaration.name),
        );
      }

      if (
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ||
        ts.isExportAssignment(statement)
      ) {
        addSymbol(symbols, sourceFile, statement, "default", "re-export", true);
      }
    }

    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement)) continue;
      if (statement.exportClause === undefined) {
        if (statement.moduleSpecifier !== undefined) {
          addSymbol(
            symbols,
            sourceFile,
            statement,
            `* from ${statement.moduleSpecifier.getText(sourceFile)}`,
            "re-export",
            true,
          );
        }
        continue;
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        addSymbol(
          symbols,
          sourceFile,
          statement,
          statement.exportClause.name.text,
          "re-export",
          true,
        );
        continue;
      }
      for (const element of statement.exportClause.elements) {
        const localName = (element.propertyName ?? element.name).text;
        if (
          statement.moduleSpecifier === undefined &&
          element.name.text === localName &&
          declaredNames.has(localName)
        ) {
          continue;
        }
        addSymbol(symbols, sourceFile, element, element.name.text, "re-export", true);
      }
    }

    return {
      kind: "success",
      symbols: [...symbols.values()].sort(
        (left, right) =>
          left.line - right.line ||
          left.kind.localeCompare(right.kind) ||
          left.name.localeCompare(right.name),
      ),
    };
  }
}

function collectLocalNamedExports(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier !== undefined ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    )
      continue;
    for (const element of statement.exportClause.elements) {
      const localName = (element.propertyName ?? element.name).text;
      if (element.name.text === localName) names.add(localName);
    }
  }
  return names;
}

function namedDeclarations(
  statement: ts.Statement,
): readonly { name: string; kind: SourceSymbolKind; node: ts.Node }[] {
  if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
    return [{ name: statement.name.text, kind: "function", node: statement }];
  }
  if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
    return [{ name: statement.name.text, kind: "class", node: statement }];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name)
        ? [{ name: declaration.name.text, kind: "variable" as const, node: declaration }]
        : [],
    );
  }
  return [];
}

function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement)?.some((modifier) => modifier.kind === kind) ?? false)
  );
}

function addSymbol(
  symbols: Map<string, SourceSymbol>,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  kind: SourceSymbolKind,
  exported: boolean,
): void {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  symbols.set(`${kind}\0${name}`, {
    name,
    kind,
    line,
    exported,
    fingerprint: createHash("sha256").update(node.getText(sourceFile)).digest("hex"),
  });
}
