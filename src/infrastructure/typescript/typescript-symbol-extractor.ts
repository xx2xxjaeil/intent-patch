import { createHash } from "node:crypto";
import ts from "typescript";
import type {
  SourceSymbolExtractor,
  SymbolExtractionResult,
} from "../../application/ports/source-symbol-extractor.js";
import type { SourceSymbol, SourceSymbolKind } from "../../domain/symbol-change.js";
import { parseTypeScriptSource } from "./parse-typescript-source.js";

interface SymbolGroup {
  readonly name: string;
  readonly kind: SourceSymbolKind;
  readonly line: number;
  readonly declarations: string[];
  exported: boolean;
}

/** TypeScript Compiler API로 이름이 있는 최상위 선언만 추출한다. */
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

    const groups = new Map<string, SymbolGroup>();
    for (const statement of sourceFile.statements) {
      const identity = declarationIdentity(statement);
      if (identity === undefined) {
        continue;
      }

      const key = `${identity.kind}\0${identity.name}`;
      const existing = groups.get(key);
      const text = statement.getText(sourceFile);
      const exported = hasExportModifier(statement);
      if (existing === undefined) {
        const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
        groups.set(key, {
          ...identity,
          line: position.line + 1,
          declarations: [text],
          exported,
        });
      } else {
        existing.declarations.push(text);
        existing.exported ||= exported;
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

function toSourceSymbol(group: SymbolGroup): SourceSymbol {
  return {
    name: group.name,
    kind: group.kind,
    line: group.line,
    exported: group.exported,
    fingerprint: createHash("sha256").update(group.declarations.join("\0")).digest("hex"),
  };
}
