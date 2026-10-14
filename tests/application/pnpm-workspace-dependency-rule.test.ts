import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  FileSnapshotSource,
  TextFileSnapshot,
} from "../../src/application/ports/file-snapshot-source.js";
import { NpmWorkspaceDependencyRule } from "../../src/application/rules/npm-workspace-dependency-rule.js";
import { PnpmWorkspaceDependencyRule } from "../../src/application/rules/pnpm-workspace-dependency-rule.js";
import { createChangeSet, type FileChange } from "../../src/domain/change.js";

const changed = (path: string): FileChange => ({
  path,
  kind: "modified",
  lines: { kind: "measured", additions: 1, deletions: 1 },
});

describe("PnpmWorkspaceDependencyRule", () => {
  it("attributes only included manifests and honors negated patterns", async () => {
    const source = snapshots({
      "pnpm-workspace.yaml": {
        before: "packages:\n  - packages/**\n  - '!packages/legacy/**'\n",
        after: "packages:\n  - packages/**\n  - '!packages/legacy/**'\n",
      },
      "packages/api/package.json": {
        before: '{"dependencies":{"old":"1"}}',
        after: '{"dependencies":{"old":"1","new":"2"}}',
      },
      "packages/legacy/api/package.json": {
        before: "{}",
        after: '{"dependencies":{"ignored":"1"}}',
      },
    });
    const rule = new PnpmWorkspaceDependencyRule(source);
    const result = await rule.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([
        changed("packages/api/package.json"),
        changed("packages/legacy/api/package.json"),
      ]),
    });
    assert.deepEqual(
      result.map(({ ruleId, evidence }) => ({ ruleId, evidence })),
      [
        {
          ruleId: "dependency/new-production",
          evidence: {
            package: "new",
            version: "2",
            section: "dependencies",
            workspace: "packages/api",
            packageManager: "pnpm",
          },
        },
      ],
    );
  });

  it("reports config changes and malformed or unsupported YAML", async () => {
    const changedRule = new PnpmWorkspaceDependencyRule(
      snapshots({
        "pnpm-workspace.yaml": {
          before: "packages:\n  - packages/*\n",
          after: "packages:\n  - apps/*\n",
        },
      }),
    );
    assert.equal(
      (
        await changedRule.analyze({
          target: { baseRef: "HEAD" },
          changes: createChangeSet([changed("pnpm-workspace.yaml")]),
        })
      )[0]?.ruleId,
      "dependency/pnpm-workspace-config-changed",
    );

    const invalid = new PnpmWorkspaceDependencyRule(
      snapshots({
        "pnpm-workspace.yaml": { before: "packages:\n  - '[bad]'\n", after: "packages: [broken\n" },
      }),
    );
    const findings = await invalid.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changed("pnpm-workspace.yaml")]),
    });
    assert.deepEqual(
      findings.map(({ ruleId, severity }) => ({ ruleId, severity })),
      [
        { ruleId: "dependency/unsupported-pnpm-workspace-pattern", severity: "low" },
        { ruleId: "dependency/invalid-pnpm-workspace-config", severity: "high" },
      ],
    );
  });

  it("prevents duplicate npm workspace findings when pnpm config is present", async () => {
    const source = snapshots({
      "pnpm-workspace.yaml": {
        before: "packages:\n  - packages/*\n",
        after: "packages:\n  - packages/*\n",
      },
      "package.json": {
        before: '{"workspaces":["packages/*"]}',
        after: '{"workspaces":["packages/*"]}',
      },
      "packages/api/package.json": { before: "{}", after: '{"dependencies":{"new":"1"}}' },
    });
    const context = {
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changed("packages/api/package.json")]),
    };
    assert.deepEqual(await new NpmWorkspaceDependencyRule(source).analyze(context), []);
    assert.equal(
      (await new PnpmWorkspaceDependencyRule(source).analyze(context))[0]?.ruleId,
      "dependency/new-production",
    );
  });
});

function snapshots(values: Readonly<Record<string, TextFileSnapshot>>): FileSnapshotSource {
  return { read: async (_target, path) => values[path] ?? {} };
}
