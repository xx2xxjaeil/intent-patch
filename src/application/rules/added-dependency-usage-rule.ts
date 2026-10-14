import type { Finding } from "../../domain/finding.js";
import type { AnalysisContext, AnalysisRule } from "../ports/analysis-rule.js";
import type { FileSnapshotSource } from "../ports/file-snapshot-source.js";
import type { ModuleReferenceExtractor } from "../ports/module-reference-extractor.js";
import type { PnpmWorkspaceParser } from "../ports/pnpm-workspace-parser.js";
import type { ProjectFileSource } from "../ports/project-file-source.js";
import { NpmWorkspaceDependencyRule } from "./npm-workspace-dependency-rule.js";
import { PackageDependencyRule } from "./package-dependency-rule.js";
import { PnpmWorkspaceDependencyRule } from "./pnpm-workspace-dependency-rule.js";

const rootManifest = "package.json";
const generatedDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "action-dist",
  ".next",
  ".turbo",
]);

/** 새 직접 dependency의 정적 소스 참조가 없을 때만 검토 후보를 제시한다. */
export class AddedDependencyUsageRule implements AnalysisRule {
  public constructor(
    private readonly snapshots: FileSnapshotSource,
    private readonly files: ProjectFileSource,
    private readonly extractor: ModuleReferenceExtractor,
    private readonly pnpmWorkspaceParser: PnpmWorkspaceParser,
  ) {}

  public async analyze(context: AnalysisContext): Promise<readonly Finding[]> {
    const manifestFindings = (
      await Promise.all([
        new PackageDependencyRule(this.snapshots, rootManifest).analyze(context),
        new NpmWorkspaceDependencyRule(this.snapshots).analyze(context),
        new PnpmWorkspaceDependencyRule(this.snapshots, this.pnpmWorkspaceParser).analyze(context),
      ])
    ).flat();
    const added = manifestFindings.filter(
      (finding) =>
        finding.ruleId === "dependency/new-production" ||
        finding.ruleId === "dependency/new-development",
    );
    if (added.length === 0) return [];

    const paths = (await this.files.listPaths(context.target)).filter(
      (path) =>
        this.extractor.supports(path) &&
        !path.split("/").some((part) => generatedDirectories.has(part)),
    );
    const referenced = new Set<string>();
    if (paths.length === 0 || paths.length > 5_000) return [];
    let complete = true;

    // 읽기·파싱 실패나 계산할 수 없는 동적 import가 있으면 미사용 후보를 단정하지 않는다.
    for (const path of paths) {
      const file = await this.files.read(context.target, path);
      if (file.kind !== "success") {
        complete = false;
        break;
      }
      const references = this.extractor.extract(path, file.content);
      if (references.kind !== "success" || references.hasDynamicSpecifier === true) {
        complete = false;
        break;
      }
      for (const specifier of references.specifiers) {
        const packageName = packageNameFromSpecifier(specifier);
        if (packageName !== undefined) referenced.add(packageName);
      }
    }
    if (!complete) return [];

    return added.flatMap((finding) => {
      const name = finding.evidence.package;
      if (typeof name !== "string" || referenced.has(name)) return [];
      return [
        {
          ruleId: "dependency/no-static-reference",
          severity: "low",
          title: "New dependency has no static source reference",
          description: `${name} was added to ${finding.file}, but no static JS/TS import was found. Check CLI, configuration, and generated-code usage before removing it.`,
          file: finding.file,
          evidence: {
            package: name,
            section: String(finding.evidence.section),
            scannedFiles: paths.length,
            ...(finding.evidence.workspace === undefined
              ? {}
              : { workspace: finding.evidence.workspace }),
            ...(finding.evidence.packageManager === undefined
              ? {}
              : { packageManager: finding.evidence.packageManager }),
          },
        } satisfies Finding,
      ];
    });
  }
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("node:")
  )
    return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}
