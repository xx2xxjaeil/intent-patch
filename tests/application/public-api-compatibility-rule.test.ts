import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PublicApiCompatibilityRule } from "../../src/application/rules/public-api-compatibility-rule.js";
import { createChangeSet } from "../../src/domain/change.js";
import { createSymbolChangeSet, type SymbolChange } from "../../src/domain/symbol-change.js";

describe("PublicApiCompatibilityRule", () => {
  it("reports a removed public function signature", async () => {
    const findings = await analyze({
      path: "src/user.ts",
      name: "findUser",
      symbolKind: "function",
      changeKind: "modified",
      beforeExported: true,
      afterExported: true,
      beforePublicApi: { kind: "function", signatures: ["(string):User"] },
      afterPublicApi: { kind: "function", signatures: ["(number):User"] },
      afterLine: 7,
    });

    assert.deepEqual(findings, [
      {
        ruleId: "api/public-signature-changed",
        severity: "high",
        title: "Public function contract changed",
        description:
          "The exported function findUser no longer provides every previous call signature.",
        file: "src/user.ts",
        evidence: {
          symbolName: "findUser",
          removedSignatures: "(string):User",
          previousSignatures: "(string):User",
          currentSignatures: "(number):User",
          currentLine: 7,
        },
      },
    ]);
  });

  it("reports removed, changed, and newly required interface members", async () => {
    const findings = await analyze({
      path: "src/user.ts",
      name: "User",
      symbolKind: "interface",
      changeKind: "modified",
      beforeExported: true,
      afterExported: true,
      beforePublicApi: {
        kind: "interface",
        extendsTypes: ["Entity"],
        members: [
          { name: "id", memberKind: "property", optional: false, signature: "string" },
          { name: "name", memberKind: "property", optional: true, signature: "string" },
        ],
      },
      afterPublicApi: {
        kind: "interface",
        extendsTypes: [],
        members: [
          { name: "id", memberKind: "property", optional: false, signature: "number" },
          { name: "email", memberKind: "property", optional: false, signature: "string" },
        ],
      },
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "api/public-interface-changed");
    assert.equal(findings[0]?.severity, "high");
    assert.equal(
      findings[0]?.evidence.changes,
      [
        "extended types changed",
        "member removed or changed: id",
        "member removed or changed: name",
        "required member added or changed: email",
        "required member added or changed: id",
      ].join("; "),
    );
  });

  it("allows implementation-only edits, added overloads, and optional interface members", async () => {
    const functionFindings = await analyze({
      path: "src/user.ts",
      name: "findUser",
      symbolKind: "function",
      changeKind: "modified",
      beforeExported: true,
      afterExported: true,
      beforePublicApi: { kind: "function", signatures: ["(string):User"] },
      afterPublicApi: {
        kind: "function",
        signatures: ["(number):User", "(string):User"],
      },
    });
    const interfaceFindings = await analyze({
      path: "src/user.ts",
      name: "User",
      symbolKind: "interface",
      changeKind: "modified",
      beforeExported: true,
      afterExported: true,
      beforePublicApi: {
        kind: "interface",
        extendsTypes: [],
        members: [{ name: "id", memberKind: "property", optional: false, signature: "string" }],
      },
      afterPublicApi: {
        kind: "interface",
        extendsTypes: [],
        members: [
          { name: "email", memberKind: "property", optional: true, signature: "string" },
          { name: "id", memberKind: "property", optional: false, signature: "string" },
        ],
      },
    });

    assert.deepEqual(functionFindings, []);
    assert.deepEqual(interfaceFindings, []);
  });

  it("ignores internal and newly exported symbols", async () => {
    const internal = await analyze({
      path: "src/internal.ts",
      name: "helper",
      symbolKind: "function",
      changeKind: "modified",
      beforeExported: false,
      afterExported: false,
      beforePublicApi: { kind: "function", signatures: ["():string"] },
      afterPublicApi: { kind: "function", signatures: ["():number"] },
    });

    assert.deepEqual(internal, []);
  });
});

async function analyze(change: SymbolChange) {
  return new PublicApiCompatibilityRule().analyze({
    target: { baseRef: "HEAD" },
    changes: createChangeSet([]),
    symbolChanges: createSymbolChangeSet([change]),
  });
}
