import ts from "typescript";
import type { FunctionSignatureCompatibility } from "../../application/ports/function-signature-compatibility.js";

const comparisonPath = "/__intentpatch_function_signatures__.ts";

/** Uses TypeScript assignability only when both self-contained signature types can be checked. */
export class TypeScriptFunctionSignatureCompatibility implements FunctionSignatureCompatibility {
  public preservesPreviousCalls(
    previous: readonly string[],
    current: readonly string[],
  ): boolean | undefined {
    const previousCalls = previous.map(toCallSignature);
    const currentCalls = current.map(toCallSignature);
    if (
      previousCalls.length === 0 ||
      currentCalls.length === 0 ||
      previousCalls.some((call) => call === undefined) ||
      currentCalls.some((call) => call === undefined)
    ) {
      return undefined;
    }

    const sourceFile = ts.createSourceFile(
      comparisonPath,
      `interface Previous { ${previousCalls.join("; ")} }\ninterface Current { ${currentCalls.join("; ")} }`,
      ts.ScriptTarget.Latest,
      true,
    );
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      lib: ["lib.es2022.d.ts"],
    };
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
      path === comparisonPath
        ? sourceFile
        : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([comparisonPath], options, host);
    if (
      program.getSyntacticDiagnostics(sourceFile).length > 0 ||
      program.getSemanticDiagnostics(sourceFile).length > 0
    ) {
      return undefined;
    }

    const checker = program.getTypeChecker();
    const declarations = sourceFile.statements.filter(ts.isInterfaceDeclaration);
    const previousSymbol = declarations[0] && checker.getSymbolAtLocation(declarations[0].name);
    const currentSymbol = declarations[1] && checker.getSymbolAtLocation(declarations[1].name);
    if (previousSymbol === undefined || currentSymbol === undefined) return undefined;

    return checker.isTypeAssignableTo(
      checker.getDeclaredTypeOfSymbol(currentSymbol),
      checker.getDeclaredTypeOfSymbol(previousSymbol),
    );
  }
}

/** Convert the extractor's name-free display signature into a call signature for the checker. */
function toCallSignature(signature: string): string | undefined {
  // The display normalizer is not string-literal-aware; avoid proving compatibility from it.
  if (/["'`]|\/\*/u.test(signature)) return undefined;

  let opening = 0;
  if (signature.startsWith("<")) {
    const genericEnd = findGenericEnd(signature);
    if (genericEnd === undefined) return undefined;
    opening = genericEnd + 1;
  }
  if (signature[opening] !== "(") return undefined;

  const closing = findMatchingParenthesis(signature, opening);
  if (closing === undefined || signature[closing + 1] !== ":") return undefined;
  const returnType = signature.slice(closing + 2);
  if (returnType.length === 0 || returnType === "inferred") return undefined;

  const parameters = splitParameters(signature.slice(opening + 1, closing));
  if (parameters === undefined) return undefined;
  const namedParameters = parameters.map((parameter, index) => nameParameter(parameter, index));
  if (namedParameters.some((parameter) => parameter === undefined)) return undefined;
  return `${signature.slice(0, opening)}(${namedParameters.join(",")}):${returnType}`;
}

function findGenericEnd(signature: string): number | undefined {
  let depth = 0;
  for (let index = 0; index < signature.length; index += 1) {
    const character = signature[index];
    if (character === "(") return undefined;
    if (character === "<") depth += 1;
    if (character === ">" && signature[index - 1] !== "=") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function findMatchingParenthesis(signature: string, opening: number): number | undefined {
  let depth = 0;
  for (let index = opening; index < signature.length; index += 1) {
    if (signature[index] === "(") depth += 1;
    if (signature[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function splitParameters(value: string): readonly string[] | undefined {
  if (value.length === 0) return [];
  const parameters: string[] = [];
  const openings = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["<", ">"],
  ]);
  const stack: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "," && stack.length === 0) {
      parameters.push(value.slice(start, index).trim());
      start = index + 1;
      continue;
    }
    const closing = character && openings.get(character);
    if (closing !== undefined) {
      stack.push(closing);
    } else if (character === ")" || character === "]" || character === "}" || character === ">") {
      if (character === ">" && value[index - 1] === "=") continue;
      if (stack.pop() !== character) return undefined;
    }
  }
  if (stack.length > 0) return undefined;
  parameters.push(value.slice(start).trim());
  return parameters;
}

function nameParameter(parameter: string, index: number): string | undefined {
  const rest = parameter.startsWith("...");
  const withoutRest = rest ? parameter.slice(3) : parameter;
  const optional = withoutRest.endsWith("?");
  const type = optional ? withoutRest.slice(0, -1) : withoutRest;
  if (type.length === 0 || type === "inferred" || (rest && optional)) return undefined;
  return `${rest ? "..." : ""}argument${index}${optional ? "?" : ""}: ${type}`;
}
