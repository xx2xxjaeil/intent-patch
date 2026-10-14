import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileSnapshotSource } from "../../src/application/ports/file-snapshot-source.js";
import { PnpmLockfileRule } from "../../src/application/rules/pnpm-lockfile-rule.js";
import { createChangeSet } from "../../src/domain/change.js";
import { PnpmYamlLockParser } from "../../src/infrastructure/pnpm/pnpm-lock-parser.js";

const lockfileChange = createChangeSet([
  {
    path: "pnpm-lock.yaml",
    kind: "modified",
    lines: { kind: "measured", additions: 1, deletions: 1 },
  },
]);

describe("PnpmLockfileRule", () => {
  it("reports unambiguous version replacements and other package additions or removals", async () => {
    const rule = createRule({
      before: lockfile(["direct@1.0.0", "removed@2.0.0"]),
      after: lockfile(["direct@1.1.0", "added@3.0.0"]),
    });

    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes: lockfileChange });
    assert.deepEqual(
      result.map(({ ruleId, evidence }) => ({ ruleId, evidence })),
      [
        {
          ruleId: "dependency/locked-package-added",
          evidence: {
            package: "added",
            version: "3.0.0",
            packageId: "added@3.0.0",
            rootDirect: false,
          },
        },
        {
          ruleId: "dependency/locked-version-changed",
          evidence: {
            package: "direct",
            version: "1.1.0",
            packageId: "direct@1.1.0",
            rootDirect: true,
            from: "1.0.0",
            to: "1.1.0",
          },
        },
        {
          ruleId: "dependency/locked-package-removed",
          evidence: {
            package: "removed",
            version: "2.0.0",
            packageId: "removed@2.0.0",
            rootDirect: false,
          },
        },
      ],
    );
  });

  it("does not guess a version pair when several versions change", async () => {
    const rule = createRule({
      before: lockfile(["same@1.0.0", "same@2.0.0"]),
      after: lockfile(["same@3.0.0", "same@4.0.0"]),
    });
    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes: lockfileChange });
    assert.deepEqual(
      result.map(({ ruleId }) => ruleId),
      [
        "dependency/locked-package-added",
        "dependency/locked-package-added",
        "dependency/locked-package-removed",
        "dependency/locked-package-removed",
      ],
    );
  });

  it("does not report metadata-only changes as resolved version changes", async () => {
    const rule = createRule({
      before: lockfile(["same@1.0.0"], "sha512-before"),
      after: lockfile(["same@1.0.0"], "sha512-after"),
    });
    assert.deepEqual(
      await rule.analyze({ target: { baseRef: "HEAD" }, changes: lockfileChange }),
      [],
    );
  });

  it("summarizes whole-file additions and reports invalid or unsupported files", async () => {
    const added = createRule({ after: lockfile(["a@1.0.0", "b@2.0.0"]) });
    assert.deepEqual(
      await added.analyze({ target: { baseRef: "HEAD" }, changes: lockfileChange }),
      [
        {
          ruleId: "dependency/pnpm-lockfile-added",
          severity: "low",
          title: "pnpm lockfile added",
          description: "pnpm-lock.yaml was added with 2 resolved registry packages.",
          file: "pnpm-lock.yaml",
          evidence: { packageCount: 2 },
        },
      ],
    );

    const invalid = createRule({
      before: "lockfileVersion: '6.0'\nimporters: {}\n",
      after: "lockfileVersion: [broken\n",
    });
    const findings = await invalid.analyze({
      target: { baseRef: "HEAD" },
      changes: lockfileChange,
    });
    assert.deepEqual(
      findings.map(({ ruleId, severity }) => ({ ruleId, severity })),
      [
        { ruleId: "dependency/unsupported-pnpm-lockfile", severity: "low" },
        { ruleId: "dependency/invalid-pnpm-lockfile", severity: "high" },
      ],
    );
  });

  it("does not read pnpm-lock.yaml for unrelated changes", async () => {
    let reads = 0;
    const rule = new PnpmLockfileRule(
      {
        read: async () => {
          reads += 1;
          return {};
        },
      },
      new PnpmYamlLockParser(),
    );
    const result = await rule.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([
        {
          path: "src/index.ts",
          kind: "modified",
          lines: { kind: "measured", additions: 1, deletions: 0 },
        },
      ]),
    });
    assert.deepEqual(result, []);
    assert.equal(reads, 0);
  });
});

function createRule(snapshot: Awaited<ReturnType<FileSnapshotSource["read"]>>): PnpmLockfileRule {
  return new PnpmLockfileRule({ read: async () => snapshot }, new PnpmYamlLockParser());
}

function lockfile(packageIds: readonly string[], integrity = "sha512-placeholder"): string {
  const packages = packageIds
    .map((id) => `  '${id}':\n    resolution: {integrity: ${integrity}}`)
    .join("\n");
  return `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      direct:\n        specifier: ^1.0.0\n        version: ${packageIds.find((id) => id.startsWith("direct@"))?.slice(7) ?? "1.0.0"}\npackages:\n${packages}\n`;
}
