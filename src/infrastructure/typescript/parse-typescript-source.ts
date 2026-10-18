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
    scriptKind(path),
  );
  const parseError = firstParseError(sourceFile);

  return parseError === undefined
    ? { kind: "success", sourceFile }
    : { kind: "unavailable", reason: parseError };
}

function firstParseError(sourceFile: ts.SourceFile): string | undefined {
  // transpileModule은 JavaScript를 방출하지 않는 .d.ts에서 예외를 던진다.
  // 단일 파일 프로그램의 공개 syntactic-diagnostics API로 파싱 오류만 확인한다.
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
    noLib: true,
    noResolve: true,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (path) => (path === sourceFile.fileName ? sourceFile : undefined);
  const diagnostic = ts
    .createProgram([sourceFile.fileName], options, host)
    .getSyntacticDiagnostics(sourceFile)
    .find((candidate) => candidate.category === ts.DiagnosticCategory.Error);
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

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(?:c|m)?js$/u.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
