import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  FileSnapshotSource,
  TextFileSnapshot,
} from "../../src/application/ports/file-snapshot-source.js";
import { NpmWorkspaceDependencyRule } from "../../src/application/rules/npm-workspace-dependency-rule.js";
import { PackageJsonWorkspaceDependencyRule } from "../../src/application/rules/package-json-workspace-dependency-rule.js";
import { createChangeSet, type FileChange } from "../../src/domain/change.js";

function changed(path: string): FileChange {
  return { path, kind: "modified", lines: { kind: "measured", additions: 1, deletions: 1 } };
}

function snapshotsByPath(
  snapshots: Readonly<Record<string, TextFileSnapshot>>,
): FileSnapshotSource {
  return { read: async (_target, path) => snapshots[path] ?? {} };
}

describe("PackageJsonWorkspaceDependencyRule", () => {
  it("keeps the previous NpmWorkspaceDependencyRule import usable", async () => {
    const rule = new NpmWorkspaceDependencyRule(
      snapshotsByPath({
        "package.json": {
          before: JSON.stringify({ workspaces: ["packages/*"] }),
          after: JSON.stringify({ workspaces: ["packages/*"] }),
        },
        "packages/api/package.json": {
          before: JSON.stringify({ dependencies: {} }),
          after: JSON.stringify({ dependencies: { added: "^2.0.0" } }),
        },
      }),
    );
    const result = await rule.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changed("packages/api/package.json")]),
    });
    assert.deepEqual(
      result.map(({ ruleId }) => ruleId),
      ["dependency/new-production"],
    );
  });

  it("attributes Yarn workspace dependency changes without treating them as npm workspaces", async () => {
    const rule = new PackageJsonWorkspaceDependencyRule(
      snapshotsByPath({
        "package.json": {
          before: JSON.stringify({ packageManager: "yarn@4.10.0", workspaces: ["packages/*"] }),
          after: JSON.stringify({ packageManager: "yarn@4.10.0", workspaces: ["packages/*"] }),
        },
        "packages/api/package.json": {
          before: JSON.stringify({ dependencies: { old: "^1.0.0" } }),
          after: JSON.stringify({ dependencies: { old: "^1.0.0", added: "^2.0.0" } }),
        },
      }),
    );
    const result = await rule.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changed("packages/api/package.json")]),
    });
    assert.deepEqual(
      result.map(({ ruleId, evidence }) => ({ ruleId, evidence })),
      [
        {
          ruleId: "dependency/new-production",
          evidence: {
            package: "added",
            version: "^2.0.0",
            section: "dependencies",
            workspace: "packages/api",
            packageManager: "yarn",
          },
        },
      ],
    );
  });

  it("recognizes Yarn from the lockfile when packageManager is not declared", async () => {
    const rule = new PackageJsonWorkspaceDependencyRule(
      snapshotsByPath({
        "package.json": {
          before: JSON.stringify({ workspaces: ["packages/*"] }),
          after: JSON.stringify({ workspaces: ["packages/*", "apps/*"] }),
        },
        "yarn.lock": { before: "lockfile", after: "lockfile" },
      }),
    );
    const result = await rule.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changed("package.json")]),
    });
    assert.deepEqual(
      result.map(({ ruleId, evidence }) => ({ ruleId, evidence })),
      [
        {
          ruleId: "dependency/yarn-workspace-config-changed",
          evidence: {
            from: '["packages/*"]',
            to: '["packages/*","apps/*"]',
            packageManager: "yarn",
          },
        },
      ],
    );
  });

  it("does not duplicate pnpm workspace findings when both lockfiles exist", async () => {
    const rule = new PackageJsonWorkspaceDependencyRule(
      snapshotsByPath({
        "package.json": {
          before: '{"workspaces":["packages/*"]}',
          after: '{"workspaces":["packages/*"]}',
        },
        "pnpm-workspace.yaml": { before: "packages:\n  - packages/*\n" },
        "yarn.lock": { after: "lockfile" },
      }),
    );
    const result = await rule.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changed("packages/api/package.json")]),
    });
    assert.deepEqual(result, []);
  });
  it("attributes dependency changes only to configured workspace manifests", async () => {
    const rule = new PackageJsonWorkspaceDependencyRule(
      snapshotsByPath({
        "package.json": {
          before: JSON.stringify({ workspaces: ["./packages/*", "apps/**"] }),
          after: JSON.stringify({ workspaces: ["./packages/*", "apps/**"] }),
        },
        "packages/api/package.json": {
          before: JSON.stringify({ dependencies: { existing: "^1.0.0" } }),
          after: JSON.stringify({ dependencies: { existing: "^1.0.0", added: "^2.0.0" } }),
        },
        "apps/admin/ui/package.json": {
          before: JSON.stringify({ devDependencies: { tooling: "^1.0.0" } }),
          after: JSON.stringify({ devDependencies: { tooling: "^2.0.0" } }),
        },
      }),
    );
    const changes = createChangeSet([
      changed("packages/api/package.json"),
      changed("apps/admin/ui/package.json"),
      changed("examples/not-a-workspace/package.json"),
    ]);

    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes });
    assert.deepEqual(
      result.map(({ ruleId, file, evidence }) => ({ ruleId, file, evidence })),
      [
        {
          ruleId: "dependency/version-changed",
          file: "apps/admin/ui/package.json",
          evidence: {
            package: "tooling",
            from: "^1.0.0",
            to: "^2.0.0",
            section: "devDependencies",
            workspace: "apps/admin/ui",
          },
        },
        {
          ruleId: "dependency/new-production",
          file: "packages/api/package.json",
          evidence: {
            package: "added",
            version: "^2.0.0",
            section: "dependencies",
            workspace: "packages/api",
          },
        },
      ],
    );
  });

  it("reports a changed workspace configuration even without nested manifest changes", async () => {
    const rule = new PackageJsonWorkspaceDependencyRule(
      snapshotsByPath({
        "package.json": {
          before: JSON.stringify({ workspaces: ["packages/*"] }),
          after: JSON.stringify({ workspaces: ["packages/*", "apps/*"] }),
        },
      }),
    );
    const result = await rule.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changed("package.json")]),
    });
    assert.deepEqual(
      result.map(({ ruleId, severity }) => ({ ruleId, severity })),
      [{ ruleId: "dependency/workspace-config-changed", severity: "low" }],
    );
  });

  it("includes a newly added workspace when the root configuration changed", async () => {
    const rule = new PackageJsonWorkspaceDependencyRule(
      snapshotsByPath({
        "package.json": {
          before: JSON.stringify({}),
          after: JSON.stringify({ workspaces: ["packages/*"] }),
        },
        "packages/new/package.json": {
          after: JSON.stringify({ dependencies: { library: "^1.0.0" } }),
        },
      }),
    );
    const changes = createChangeSet([
      changed("package.json"),
      { ...changed("packages/new/package.json"), kind: "added" },
    ]);

    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes });
    assert.deepEqual(
      result.map(({ ruleId }) => ruleId),
      ["dependency/workspace-config-changed", "dependency/new-production"],
    );
  });

  it("reports invalid and unsupported workspace configurations", async () => {
    const rule = new PackageJsonWorkspaceDependencyRule(
      snapshotsByPath({
        "package.json": {
          before: JSON.stringify({ workspaces: ["packages/*", "!packages/legacy"] }),
          after: JSON.stringify({ workspaces: { packages: ["packages/*"] } }),
        },
      }),
    );
    const result = await rule.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changed("package.json")]),
    });
    assert.deepEqual(
      result.map(({ ruleId, severity }) => ({ ruleId, severity })),
      [
        { ruleId: "dependency/unsupported-workspace-pattern", severity: "low" },
        { ruleId: "dependency/invalid-workspace-config", severity: "high" },
      ],
    );
  });

  it("reports a manifest moved out of a workspace even when dependencies stay the same", async () => {
    const unchanged = JSON.stringify({ dependencies: { existing: "^1.0.0" } });
    const rule = new PackageJsonWorkspaceDependencyRule(
      snapshotsByPath({
        "package.json": {
          before: JSON.stringify({ workspaces: ["packages/*"] }),
          after: JSON.stringify({ workspaces: ["packages/*"] }),
        },
        "examples/api/package.json": { before: unchanged, after: unchanged },
      }),
    );
    const changes = createChangeSet([
      {
        path: "examples/api/package.json",
        previousPath: "packages/api/package.json",
        kind: "renamed",
        lines: { kind: "measured", additions: 0, deletions: 0 },
      },
    ]);

    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes });
    assert.deepEqual(
      result.map(({ ruleId, evidence }) => ({ ruleId, evidence })),
      [
        {
          ruleId: "dependency/workspace-membership-changed",
          evidence: {
            previousPath: "packages/api/package.json",
            currentPath: "examples/api/package.json",
            fromWorkspace: true,
            toWorkspace: false,
          },
        },
      ],
    );
  });

  it("does not attribute a copy outside the workspace to its source", async () => {
    const rule = new PackageJsonWorkspaceDependencyRule(
      snapshotsByPath({
        "package.json": {
          before: JSON.stringify({ workspaces: ["packages/*"] }),
          after: JSON.stringify({ workspaces: ["packages/*"] }),
        },
      }),
    );
    const changes = createChangeSet([
      {
        path: "examples/copy/package.json",
        previousPath: "packages/source/package.json",
        kind: "copied",
        lines: { kind: "measured", additions: 1, deletions: 0 },
      },
    ]);

    const result = await rule.analyze({ target: { baseRef: "HEAD" }, changes });
    assert.deepEqual(result, []);
  });

  it("does not read snapshots when no package manifest changed", async () => {
    let readCount = 0;
    const rule = new PackageJsonWorkspaceDependencyRule({
      read: async () => {
        readCount += 1;
        return {};
      },
    });
    const result = await rule.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([changed("src/index.ts")]),
    });
    assert.deepEqual(result, []);
    assert.equal(readCount, 0);
  });
});
