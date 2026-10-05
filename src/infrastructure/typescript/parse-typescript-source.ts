import ts from "typescript";

export type TypeScriptParseResult =
  | Readonly<{ kind: "success"; sourceFile: ts.SourceFile }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

/** TypeScript 파싱과 진단 메시지 형식을 AST 기반 어댑터 사이에서 공유한다. */
export function parseTypeScriptSource(path: string, source: string): TypeScriptParseResult {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const parseError = firstParseError(path, source);

  return parseError === undefined
    ? { kind: "success", sourceFile }
    : { kind: "unavailable", reason: parseError };
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
