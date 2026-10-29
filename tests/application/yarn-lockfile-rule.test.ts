import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { YarnLockfileRule } from "../../src/application/rules/yarn-lockfile-rule.js";
import { createChangeSet } from "../../src/domain/change.js";
import { YarnYamlLockParser } from "../../src/infrastructure/yarn/yarn-lock-parser.js";

const lock = (version: string) =>
  `__metadata:\n  version: 8\n"foo@npm:^1":\n  version: ${version}\n  resolution: "foo@npm:${version}"\n`;

describe("YarnLockfileRule", () => {
  it("reports a resolved version change", async () => {
    const rule = new YarnLockfileRule(
      { read: async () => ({ before: lock("1.0.0"), after: lock("1.1.0") }) },
      new YarnYamlLockParser(),
    );
    const findings = await rule.analyze({
      target: { baseRef: "HEAD" },
      changes: createChangeSet([
        {
          path: "yarn.lock",
          kind: "modified",
          lines: { kind: "measured", additions: 1, deletions: 1 },
        },
      ]),
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "dependency/locked-version-changed");
    assert.deepEqual(findings[0]?.evidence, {
      package: "foo",
      version: "1.1.0",
      packageId: "foo@npm:1.1.0",
      rootDirect: false,
      packageManager: "yarn",
      from: "1.0.0",
      to: "1.1.0",
    });
  });
});
