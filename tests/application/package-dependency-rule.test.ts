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

  it("uses a workspace manifest path and reads the previous path for renames", async () => {
    const reads: { path: string; basePath?: string }[] = [];
    const rule = new PackageDependencyRule(
      {
        read: async (_target, path, basePath) => {
          reads.push({ path, ...(basePath === undefined ? {} : { basePath }) });
          return {
            before: JSON.stringify({ dependencies: { existing: "^1.0.0" } }),
            after: JSON.stringify({ dependencies: { existing: "^1.0.0", added: "^2.0.0" } }),
          };
        },
      },
      "packages/new/package.json",
    );
    const changes = createChangeSet([
      {
        path: "packages/new/package.json",
        previousPath: "packages/old/package.json",
        kind: "renamed",
        lines: { kind: "measured", additions: 1, deletions: 0 },
      },
    ]);

    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes });
    assert.deepEqual(reads, [
      { path: "packages/new/package.json", basePath: "packages/old/package.json" },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.file, "packages/new/package.json");
    assert.equal(result[0]?.evidence.package, "added");
  });

  it("does not treat a copied manifest as the same original package", async () => {
    let basePath: string | undefined;
    const rule = new PackageDependencyRule(
      {
        read: async (_target, _path, previousPath) => {
          basePath = previousPath;
          return { after: JSON.stringify({ dependencies: { copied: "^1.0.0" } }) };
        },
      },
      "packages/copy/package.json",
    );
    const changes = createChangeSet([
      {
        path: "packages/copy/package.json",
        previousPath: "packages/original/package.json",
        kind: "copied",
        lines: { kind: "measured", additions: 1, deletions: 0 },
      },
    ]);

    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes });
    assert.equal(basePath, undefined);
    assert.equal(result[0]?.ruleId, "dependency/new-production");
  });
});

function snapshotSource(
  snapshot: Awaited<ReturnType<FileSnapshotSource["read"]>>,
): FileSnapshotSource {
  return {
    read: async () => snapshot,
  };
}
