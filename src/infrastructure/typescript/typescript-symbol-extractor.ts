import { createHash } from "node:crypto";
import ts from "typescript";
import type {
  SourceSymbolExtractor,
  SymbolExtractionResult,
} from "../../application/ports/source-symbol-extractor.js";
import type { SourceSymbol, SourceSymbolKind } from "../../domain/symbol-change.js";

interface SymbolGroup {
  readonly name: string;
  readonly kind: SourceSymbolKind;
  readonly line: number;
  readonly declarations: string[];
}

/** TypeScript Compiler API로 이름이 있는 최상위 선언만 추출한다. */
export class TypeScriptSymbolExtractor implements SourceSymbolExtractor {
  public supports(path: string): boolean {
    return path.endsWith(".ts") || path.endsWith(".tsx");
  }

  public extract(path: string, source: string): SymbolExtractionResult {
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const parseError = firstParseError(path, source);

    if (parseError !== undefined) {
      return { kind: "unavailable", reason: parseError };
    }

    const groups = new Map<string, SymbolGroup>();
    for (const statement of sourceFile.statements) {
      const identity = declarationIdentity(statement);
      if (identity === undefined) {
        continue;
      }

      const key = `${identity.kind}\0${identity.name}`;
      const existing = groups.get(key);
      const text = statement.getText(sourceFile);
      if (existing === undefined) {
        const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
        groups.set(key, {
          ...identity,
          line: position.line + 1,
          declarations: [text],
        });
      } else {
        existing.declarations.push(text);
      }
    }

    const symbols = [...groups.values()]
      .map(toSourceSymbol)
      .sort(
        (left, right) =>
          left.line - right.line ||
          left.kind.localeCompare(right.kind) ||
          left.name.localeCompare(right.name),
      );
    return { kind: "success", symbols };
  }
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

function toSourceSymbol(group: SymbolGroup): SourceSymbol {
  return {
    name: group.name,
    kind: group.kind,
    line: group.line,
    fingerprint: createHash("sha256").update(group.declarations.join("\0")).digest("hex"),
  };
}

function firstParseError(path: string, source: string): string | undefined {
  const diagnostic = ts
    .transpileModule(source, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.Latest,
      },
    })
    .diagnostics?.find((candidate) => candidate.category === ts.DiagnosticCategory.Error);
  if (diagnostic === undefined) {
    return undefined;
  }

  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return message;
  }
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `line ${position.line + 1}, column ${position.character + 1}: ${message}`;
}
