import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createChangeContract } from "../../src/domain/change-contract.js";

describe("createChangeContract", () => {
  it("normalizes, deduplicates, and freezes the contract", () => {
    const contract = createChangeContract({
      intent: "  회원 탈퇴 구현  ",
      scope: {
        include: ["./tests/user/**", "src\\user\\**", "src/user/**"],
        allow: ["package.json"],
        maxFiles: 8,
        maxLines: 300,
      },
      tests: {
        requireFor: ["src/**/*.ts"],
        include: ["tests/**", "**/*.test.ts"],
        exclude: ["src/**/*.d.ts"],
      },
    });

    assert.deepEqual(contract, {
      intent: "회원 탈퇴 구현",
      scope: {
        include: ["src/user/**", "tests/user/**"],
        allow: ["package.json"],
        maxFiles: 8,
        maxLines: 300,
      },
      tests: {
        requireFor: ["src/**/*.ts"],
        include: ["**/*.test.ts", "tests/**"],
        exclude: ["src/**/*.d.ts"],
      },
    });
    assert.equal(Object.isFrozen(contract), true);
    assert.equal(Object.isFrozen(contract.scope), true);
    assert.equal(Object.isFrozen(contract.scope.include), true);
  });

  it("uses an empty scope when optional fields are absent", () => {
    assert.deepEqual(createChangeContract({}), {
      scope: { include: [], allow: [] },
    });
  });

  it("rejects blank, escaping, and invalid budget values", () => {
    assert.throws(() => createChangeContract({ intent: " " }), /must not be blank/);
    assert.throws(
      () => createChangeContract({ scope: { include: ["../secrets/**"] } }),
      /repository-relative/,
    );
    assert.throws(() => createChangeContract({ scope: { maxFiles: 1.5 } }), /non-negative integer/);
    assert.throws(() => createChangeContract({ scope: { maxLines: -1 } }), /non-negative integer/);
    assert.throws(
      () => createChangeContract({ tests: { include: ["tests/**"] } }),
      /tests.requireFor must contain/,
    );
    assert.throws(
      () => createChangeContract({ tests: { requireFor: ["src/**"] } }),
      /tests.include must contain/,
    );
  });
});
