import { parseAllDocuments } from "yaml";
import { invalidParseResult as invalid } from "../../application/ports/parse-failure.js";
import type {
  PnpmWorkspaceParseResult,
  PnpmWorkspaceParser,
} from "../../application/ports/pnpm-workspace-parser.js";
import { isRecord } from "../../domain/value-guards.js";

/** pnpm-workspace.yaml의 packages 필드와 지원 가능한 glob 부분집합을 해석한다. */
export class PnpmYamlWorkspaceParser implements PnpmWorkspaceParser {
  public parse(content: string | undefined): PnpmWorkspaceParseResult {
    if (content === undefined || content.trim().length === 0) {
      return { ok: true, patterns: { includes: [], excludes: [] } };
    }
    try {
      const documents = parseAllDocuments(content, { stringKeys: true, logLevel: "error" });
      if (documents.length !== 1 || documents[0] === undefined) {
        return invalid("Expected one YAML document.");
      }
      const document = documents[0];
      if (document.errors.length > 0) {
        return invalid(
          `The file is not valid YAML: ${document.errors[0]?.message ?? "unknown error"}`,
        );
      }
      const value: unknown = document.toJS({ maxAliasCount: 100 });
      if (!isRecord(value)) return invalid("The root value must be a YAML mapping.");
      if (value.packages === undefined)
        return { ok: true, patterns: { includes: [], excludes: [] } };
      if (!Array.isArray(value.packages)) return invalid("packages must be an array of paths.");

      const includes: string[] = [];
      const excludes: string[] = [];
      for (const raw of value.packages) {
        if (typeof raw !== "string" || raw.trim().length === 0) {
          return invalid("Each package path must be a non-empty string.");
        }
        const excluded = raw.startsWith("!");
        const pattern = raw
          .slice(excluded ? 1 : 0)
          .replace(/^(\.\/)+/u, "")
          .replace(/\/+$/u, "");
        if (pattern.length === 0 || pattern.startsWith("/") || pattern.split("/").includes("..")) {
          return invalid(`Invalid workspace path: ${raw}.`);
        }
        if (/[{}[\]\\!]/u.test(pattern)) {
          return {
            ok: false,
            kind: "unsupported",
            reason: `Unsupported workspace pattern: ${raw}. Only *, **, and ? globs are supported.`,
          };
        }
        (excluded ? excludes : includes).push(pattern);
      }
      return {
        ok: true,
        patterns: {
          includes: [...new Set(includes)].sort(),
          excludes: [...new Set(excludes)].sort(),
        },
      };
    } catch (error) {
      return invalid(
        `The YAML parser could not read the configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
