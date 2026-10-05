import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileSnapshotSource } from "../../src/application/ports/file-snapshot-source.js";
import { PackageDependencyRule } from "../../src/application/rules/package-dependency-rule.js";
import { createChangeSet } from "../../src/domain/change.js";

const manifestChange = createChangeSet([
  {
    path: "package.json",
    kind: "modified",
    lines: { kind: "measured", additions: 1, deletions: 1 },
  },
]);

describe("PackageDependencyRule", () => {
  it("reports direct dependency additions, removals, moves, and version changes", async () => {
    const rule = new PackageDependencyRule(
      snapshotSource({
        before: JSON.stringify({
          dependencies: {
            changed: "1.0.0",
            removed: "1.0.0",
          },
          devDependencies: {
            moved: "2.0.0",
          },
        }),
        after: JSON.stringify({
          dependencies: {
            changed: "2.0.0",
            moved: "2.0.0",
            production: "3.0.0",
          },
          devDependencies: {
            development: "4.0.0",
          },
        }),
      }),
    );

    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes: manifestChange });
    const byPackage = new Map(result.map((item) => [item.evidence.package, item]));

    assert.deepEqual(
      {
        ruleId: byPackage.get("production")?.ruleId,
        severity: byPackage.get("production")?.severity,
      },
      { ruleId: "dependency/new-production", severity: "medium" },
    );
    assert.deepEqual(
      {
        ruleId: byPackage.get("development")?.ruleId,
        severity: byPackage.get("development")?.severity,
      },
      { ruleId: "dependency/new-development", severity: "low" },
    );
    assert.equal(byPackage.get("removed")?.ruleId, "dependency/removed");
    assert.equal(byPackage.get("moved")?.ruleId, "dependency/section-changed");
    assert.equal(byPackage.get("changed")?.ruleId, "dependency/version-changed");
    assert.equal(result.length, 5);
  });

  it("returns a high finding instead of throwing for invalid JSON", async () => {
    const rule = new PackageDependencyRule(
      snapshotSource({
        before: "{}",
        after: "{ invalid",
      }),
    );

    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes: manifestChange });

    assert.deepEqual(
      result.map(({ ruleId, severity }) => ({ ruleId, severity })),
      [{ ruleId: "dependency/invalid-manifest", severity: "high" }],
    );
  });

  it("does not read snapshots when package.json did not change", async () => {
    let readCount = 0;
    const rule = new PackageDependencyRule({
      read: async () => {
        readCount += 1;
        return {};
      },
    });

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
    assert.equal(readCount, 0);
  });
});

function snapshotSource(
  snapshot: Awaited<ReturnType<FileSnapshotSource["read"]>>,
): FileSnapshotSource {
  return {
    read: async () => snapshot,
  };
}
