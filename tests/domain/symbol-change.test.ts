import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSymbolChangeSet } from "../../src/domain/symbol-change.js";

describe("createSymbolChangeSet", () => {
  it("sorts changes and calculates a summary", () => {
    const result = createSymbolChangeSet(
      [
        {
          path: "src/user.ts",
          name: "UserService",
          symbolKind: "class",
          changeKind: "modified",
          beforeLine: 3,
          afterLine: 4,
        },
        {
          path: "src/account.ts",
          name: "deleteAccount",
          symbolKind: "function",
          changeKind: "added",
          afterLine: 10,
          afterPublicApi: { kind: "function", signatures: ["():void"] },
        },
      ],
      [{ path: "src/broken.ts", reason: "Syntax error" }],
      2,
    );

    assert.deepEqual(
      result.changes.map(({ path, name }) => ({ path, name })),
      [
        { path: "src/account.ts", name: "deleteAccount" },
        { path: "src/user.ts", name: "UserService" },
      ],
    );
    assert.deepEqual(result.summary, {
      total: 2,
      filesAnalyzed: 2,
      filesUnavailable: 1,
      byChangeKind: { added: 1, modified: 1, deleted: 0 },
    });
    assert.deepEqual(result.changes[0]?.afterPublicApi, {
      kind: "function",
      signatures: ["():void"],
    });
    assert.equal(Object.isFrozen(result.changes[0]?.afterPublicApi), true);
  });

  it("rejects duplicate symbol identities", () => {
    assert.throws(
      () =>
        createSymbolChangeSet([
          {
            path: "src/user.ts",
            name: "User",
            symbolKind: "interface",
            changeKind: "added",
            afterLine: 1,
          },
          {
            path: "src/user.ts",
            name: "User",
            symbolKind: "interface",
            changeKind: "modified",
            beforeLine: 1,
            afterLine: 2,
          },
        ]),
      /Duplicate symbol change/,
    );
  });
});
