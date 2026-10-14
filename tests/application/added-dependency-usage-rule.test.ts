import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileSnapshotSource } from "../../src/application/ports/file-snapshot-source.js";
import type { ProjectFileSource } from "../../src/application/ports/project-file-source.js";
import { AddedDependencyUsageRule } from "../../src/application/rules/added-dependency-usage-rule.js";
import { createChangeSet } from "../../src/domain/change.js";
import { PackageModuleReferenceExtractor } from "../../src/infrastructure/typescript/package-module-reference-extractor.js";

const changes = createChangeSet([
  {
    path: "package.json",
    kind: "modified",
    lines: { kind: "measured", additions: 1, deletions: 0 },
  },
]);
const context = { target: { baseRef: "HEAD" }, changes };

describe("AddedDependencyUsageRule", () => {
  it("reports only added packages without a static JS/TS reference", async () => {
    const rule = createRule(
      {
        before: JSON.stringify({ dependencies: { existing: "1" } }),
        after: JSON.stringify({ dependencies: { existing: "1", "@scope/used": "2", unused: "3" } }),
      },
      { "src/index.ts": "import { x } from '@scope/used/subpath';\n" },
    );
    const findings = await rule.analyze(context);
    assert.deepEqual(
      findings.map(({ ruleId, evidence }) => ({ ruleId, evidence })),
      [
        {
          ruleId: "dependency/no-static-reference",
          evidence: { package: "unused", section: "dependencies", scannedFiles: 1 },
        },
      ],
    );
  });

  it("suppresses the candidate when dynamic imports or unreadable source make coverage incomplete", async () => {
    const snapshot = { before: "{}", after: '{"dependencies":{"candidate":"1"}}' };
    const dynamic = createRule(snapshot, { "src/index.js": "require(name)" });
    assert.deepEqual(await dynamic.analyze(context), []);
    const unreadable = new AddedDependencyUsageRule(
      { read: async () => snapshot },
      {
        listPaths: async () => ["src/index.ts"],
        read: async () => ({ kind: "unavailable", reason: "too large" }),
      },
      new PackageModuleReferenceExtractor(),
    );
    assert.deepEqual(await unreadable.analyze(context), []);
  });

  it("ignores generated bundles but scans normal JS config and does not run for unchanged manifests", async () => {
    const rule = createRule(
      { before: "{}", after: '{"devDependencies":{"tool":"1"}}' },
      { "action-dist/index.cjs": "require('tool')", "tool.config.js": "export default {};" },
    );
    assert.equal((await rule.analyze(context))[0]?.evidence.package, "tool");
    assert.deepEqual(await rule.analyze({ ...context, changes: createChangeSet([]) }), []);
  });
});

function createRule(
  snapshot: Awaited<ReturnType<FileSnapshotSource["read"]>>,
  contents: Readonly<Record<string, string>>,
): AddedDependencyUsageRule {
  const files: ProjectFileSource = {
    listPaths: async () => Object.keys(contents),
    read: async (_target, path) => ({ kind: "success", content: contents[path] ?? "" }),
  };
  return new AddedDependencyUsageRule(
    { read: async () => snapshot },
    files,
    new PackageModuleReferenceExtractor(),
  );
}
