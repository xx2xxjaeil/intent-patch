import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  type ChangeContract,
  type CreateChangeContractInput,
  createChangeContract,
} from "../../domain/change-contract.js";

const defaultConfigurationFile = ".intentpatch.json";
const rootFields = new Set(["intent", "scope"]);
const scopeFields = new Set(["include", "allow", "maxFiles", "maxLines"]);

/** JSON 설정을 엄격하게 검증하고 ChangeContract 도메인 모델로 변환한다. */
export class JsonChangeContractLoader {
  public async load(
    workingDirectory: string,
    configurationPath?: string,
  ): Promise<ChangeContract | undefined> {
    const path = resolveConfigurationPath(workingDirectory, configurationPath);
    let content: string;

    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if (isFileNotFound(error) && configurationPath === undefined) {
        return undefined;
      }
      if (isFileNotFound(error)) {
        throw new Error(`Change contract file not found: ${path}`, { cause: error });
      }
      throw error;
    }

    try {
      return createChangeContract(parseConfiguration(content));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid change contract at ${path}: ${reason}`, { cause: error });
    }
  }
}

function resolveConfigurationPath(workingDirectory: string, configurationPath?: string): string {
  if (configurationPath === undefined) {
    return resolve(workingDirectory, defaultConfigurationFile);
  }
  return isAbsolute(configurationPath)
    ? configurationPath
    : resolve(workingDirectory, configurationPath);
}

function parseConfiguration(content: string): CreateChangeContractInput {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (!isRecord(value)) {
    throw new Error("The root value must be a JSON object.");
  }
  assertKnownFields(value, rootFields, "root");

  const intent = optionalString(value.intent, "intent");
  const scopeValue = value.scope;
  if (scopeValue !== undefined && !isRecord(scopeValue)) {
    throw new Error("scope must be a JSON object.");
  }
  const scope = scopeValue ?? {};
  assertKnownFields(scope, scopeFields, "scope");

  return {
    ...(intent === undefined ? {} : { intent }),
    scope: {
      include: optionalStringArray(scope.include, "scope.include"),
      allow: optionalStringArray(scope.allow, "scope.allow"),
      ...(scope.maxFiles === undefined
        ? {}
        : { maxFiles: requiredNumber(scope.maxFiles, "scope.maxFiles") }),
      ...(scope.maxLines === undefined
        ? {}
        : { maxLines: requiredNumber(scope.maxLines, "scope.maxLines") }),
    },
  };
}

function assertKnownFields(
  value: Readonly<Record<string, unknown>>,
  knownFields: ReadonlySet<string>,
  location: string,
): void {
  const unknownField = Object.keys(value).find((field) => !knownFields.has(field));
  if (unknownField !== undefined) {
    throw new Error(`Unknown ${location} field: ${unknownField}`);
  }
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${field} must be an array of strings.`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new Error(`${field} must be a number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
