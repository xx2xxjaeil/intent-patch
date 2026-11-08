import assert from "node:assert/strict";
import { it } from "node:test";
import { traceIntentToFiles } from "../../src/application/services/trace-intent-to-files.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createChangeContract } from "../../src/domain/change-contract.js";

it("traces each changed path to declared expected or allowed patterns", () => {
  const contract = createChangeContract({
    intent: "Update account deletion",
    scope: { include: ["src/account/**"], allow: ["docs/**", "src/**"] },
  });
  const files = createChangeSet([
    {
      path: "src/account/delete.ts",
      kind: "modified",
      lines: { kind: "measured", additions: 1, deletions: 0 },
    },
    {
      path: "docs/account.md",
      kind: "modified",
      lines: { kind: "measured", additions: 1, deletions: 0 },
    },
    {
      path: "scripts/release.ts",
      kind: "modified",
      lines: { kind: "measured", additions: 1, deletions: 0 },
    },
  ]).files;

  assert.deepEqual(traceIntentToFiles(contract, files), [
    { path: "docs/account.md", relation: "allowed", patterns: ["docs/**"] },
    { path: "scripts/release.ts", relation: "outside", patterns: [] },
    { path: "src/account/delete.ts", relation: "expected", patterns: ["src/account/**"] },
  ]);
});
