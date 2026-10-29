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

  it("suppresses a textual signature change when compatibility is established", async () => {
    const findings = await analyze(
      {
        path: "src/api.ts",
        name: "createId",
        symbolKind: "function",
        changeKind: "modified",
        beforeExported: true,
        afterExported: true,
        beforePublicApi: { kind: "function", signatures: ["(string,number):string"] },
        afterPublicApi: { kind: "function", signatures: ["(string,number?):string"] },
      },
      true,
    );

    assert.deepEqual(findings, []);
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

  it("reports removed members of an exported object type alias", async () => {
    const findings = await analyze({
      path: "src/options.ts",
      name: "Options",
      symbolKind: "type-alias",
      changeKind: "modified",
      beforeExported: true,
      afterExported: true,
      beforePublicApi: {
        kind: "type-alias",
        members: [
          { name: "timeout", memberKind: "property", optional: true, signature: "number" },
          { name: "throwOnTimeout", memberKind: "property", optional: true, signature: "boolean" },
        ],
      },
      afterPublicApi: {
        kind: "type-alias",
        members: [{ name: "timeout", memberKind: "property", optional: true, signature: "number" }],
      },
      afterLine: 4,
    });

    assert.deepEqual(findings, [
      {
        ruleId: "api/public-type-member-removed",
        severity: "high",
        title: "Public type member removed",
        description: "The exported type Options no longer contains every previous member.",
        file: "src/options.ts",
        evidence: { symbolName: "Options", removedMembers: "throwOnTimeout", currentLine: 4 },
      },
    ]);
  });

  it("does not mistake added members or type annotation edits for removals", async () => {
    const findings = await analyze({
      path: "src/options.ts",
      name: "Options",
      symbolKind: "type-alias",
      changeKind: "modified",
      beforeExported: true,
      afterExported: true,
      beforePublicApi: {
        kind: "type-alias",
        members: [{ name: "timeout", memberKind: "property", optional: true, signature: "number" }],
      },
      afterPublicApi: {
        kind: "type-alias",
        members: [
          { name: "timeout", memberKind: "property", optional: true, signature: "bigint" },
          { name: "signal", memberKind: "property", optional: true, signature: "AbortSignal" },
        ],
      },
    });

    assert.deepEqual(findings, []);
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

  it("accepts appended optional method parameters but not required ones or changed return types", async () => {
    const change = (currentSignature: string) => ({
      path: "src/port.ts",
      name: "ProjectFileSource",
      symbolKind: "interface" as const,
      changeKind: "modified" as const,
      beforeExported: true,
      afterExported: true,
      beforePublicApi: {
        kind: "interface" as const,
        extendsTypes: [],
        members: [
          {
            name: "read",
            memberKind: "method" as const,
            optional: false,
            signature: "(AnalysisTarget,string):Promise<string>",
          },
        ],
      },
      afterPublicApi: {
        kind: "interface" as const,
        extendsTypes: [],
        members: [
          {
            name: "read",
            memberKind: "method" as const,
            optional: false,
            signature: currentSignature,
          },
        ],
      },
    });

    assert.deepEqual(
      await analyze(change("(AnalysisTarget,string,ProjectSnapshot?):Promise<string>")),
      [],
    );
    assert.equal(
      (await analyze(change("(AnalysisTarget,string,ProjectSnapshot):Promise<string>")))[0]?.ruleId,
      "api/public-interface-changed",
    );
    assert.equal(
      (await analyze(change("(AnalysisTarget,string,ProjectSnapshot?):Promise<number>")))[0]
        ?.ruleId,
      "api/public-interface-changed",
    );
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

  it("ignores a file confirmed outside the package public entrypoints", async () => {
    const findings = await analyze({
      path: "src/internal.ts",
      name: "helper",
      symbolKind: "function",
      changeKind: "modified",
      beforeExported: true,
      afterExported: true,
      beforePubliclyReachable: false,
      beforePublicApi: { kind: "function", signatures: ["(string):void"] },
      afterPublicApi: { kind: "function", signatures: ["(number):void"] },
    });

    assert.deepEqual(findings, []);
  });
});

async function analyze(change: SymbolChange, compatible: boolean | undefined = undefined) {
  return new PublicApiCompatibilityRule(
    { preservesPreviousCalls: () => compatible },
    { preservesOptionalObjectExtensions: () => false },
  ).analyze({
    target: { baseRef: "HEAD" },
    changes: createChangeSet([]),
    symbolChanges: createSymbolChangeSet([change]),
  });
}
