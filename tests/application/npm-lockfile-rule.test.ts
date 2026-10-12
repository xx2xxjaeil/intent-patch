import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileSnapshotSource } from "../../src/application/ports/file-snapshot-source.js";
import { NpmLockfileRule } from "../../src/application/rules/npm-lockfile-rule.js";
import { createChangeSet } from "../../src/domain/change.js";
import { NpmPackageLockParser } from "../../src/infrastructure/npm/npm-package-lock-parser.js";

const lockfileChange = createChangeSet([
  {
    path: "package-lock.json",
    kind: "modified",
    lines: { kind: "measured", additions: 1, deletions: 1 },
  },
]);

describe("NpmLockfileRule", () => {
  it("reports additions, removals, and resolved version changes by install location", async () => {
    const rule = createRule({
      before: lockfile({
        "": { dependencies: { direct: "^1.0.0" } },
        "node_modules/direct": { version: "1.1.0" },
        "node_modules/removed": { version: "1.0.0" },
        "node_modules/parent/node_modules/nested": { version: "1.0.0" },
      }),
      after: lockfile({
        "": { dependencies: { direct: "^1.0.0" } },
        "node_modules/direct": { version: "1.2.0" },
        "node_modules/added": { version: "2.0.0" },
        "node_modules/parent/node_modules/nested": { version: "2.0.0" },
      }),
    });

    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes: lockfileChange });
    assert.deepEqual(
      result.map(({ ruleId, evidence }) => ({
        ruleId,
        path: evidence.installPath,
        rootDirect: evidence.rootDirect,
      })),
      [
        {
          ruleId: "dependency/locked-package-added",
          path: "node_modules/added",
          rootDirect: false,
        },
        {
          ruleId: "dependency/locked-version-changed",
          path: "node_modules/direct",
          rootDirect: true,
        },
        {
          ruleId: "dependency/locked-version-changed",
          path: "node_modules/parent/node_modules/nested",
          rootDirect: false,
        },
        {
          ruleId: "dependency/locked-package-removed",
          path: "node_modules/removed",
          rootDirect: false,
        },
      ],
    );
  });

  it("does not report a lockfile format upgrade if installed packages are unchanged", async () => {
    const packages = { "": {}, "node_modules/same": { version: "1.0.0" } };
    const rule = createRule({
      before: lockfile(packages, 2),
      after: lockfile(packages, 3),
    });
    assert.deepEqual(
      await rule.analyze({ target: { baseRef: "HEAD" }, changes: lockfileChange }),
      [],
    );
  });

  it("summarizes a whole lockfile addition instead of emitting one finding per package", async () => {
    const rule = createRule({
      after: lockfile({
        "": {},
        "node_modules/a": { version: "1" },
        "node_modules/b": { version: "2" },
      }),
    });
    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes: lockfileChange });
    assert.deepEqual(
      result.map(({ ruleId, evidence }) => ({ ruleId, evidence })),
      [{ ruleId: "dependency/lockfile-added", evidence: { packageCount: 2 } }],
    );
  });

  it("reports malformed and unsupported lockfiles as findings", async () => {
    const rule = createRule({
      before: JSON.stringify({ lockfileVersion: 1, dependencies: {} }),
      after: "{ invalid",
    });
    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes: lockfileChange });
    assert.deepEqual(
      result.map(({ ruleId, severity }) => ({ ruleId, severity })),
      [
        { ruleId: "dependency/unsupported-lockfile", severity: "low" },
        { ruleId: "dependency/invalid-lockfile", severity: "high" },
      ],
    );
  });

  it("does not read the lockfile for unrelated changes", async () => {
    let readCount = 0;
    const rule = new NpmLockfileRule(
      {
        read: async () => {
          readCount += 1;
          return {};
        },
      },
      new NpmPackageLockParser(),
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
    assert.equal(readCount, 0);
  });
});

function createRule(snapshot: Awaited<ReturnType<FileSnapshotSource["read"]>>): NpmLockfileRule {
  return new NpmLockfileRule({ read: async () => snapshot }, new NpmPackageLockParser());
}

function lockfile(packages: Record<string, unknown>, lockfileVersion = 3): string {
  return JSON.stringify({ lockfileVersion, packages });
}
