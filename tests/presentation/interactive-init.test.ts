import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectInteractiveContract } from "../../src/presentation/cli/interactive-init.js";

const changes = ["src/api.ts", "tests/api.test.ts", "docs/guide.md"].map((path) => ({
  path,
  kind: "modified" as const,
  lines: { kind: "measured" as const, additions: 1, deletions: 0 },
}));

function scriptedPrompt(answers: readonly string[]) {
  const remaining = [...answers];
  const written: string[] = [];
  return {
    prompt: {
      question: async (_text: string) => {
        const answer = remaining.shift();
        assert.notEqual(answer, undefined, "unexpected prompt");
        return answer ?? "";
      },
      write: (text: string) => written.push(text),
    },
    written,
    remaining,
  };
}

describe("interactive init", () => {
  it("uses only user-selected paths and normalizes a complete contract", async () => {
    const script = scriptedPrompt([
      "Delete account", // request
      "1", // expected changed paths
      "src/shared/**", // additional expected path
      "3", // allowed exception
      "", // no additional allowed path
      "5", // file budget
      "100", // line budget
      "y", // test policy
      "1", // source requiring a test
      "", // no additional source pattern
      "2", // test path
      "tests/**/*.test.ts", // additional test pattern
      "src/**/*.d.ts", // excluded source
      "yes", // confirm
    ]);
    const contract = await collectInteractiveContract(changes, script.prompt);
    assert.deepEqual(contract?.scope.include, ["src/api.ts", "src/shared/**"]);
    assert.deepEqual(contract?.scope.allow, ["docs/guide.md"]);
    assert.equal(contract?.scope.maxFiles, 5);
    assert.equal(contract?.scope.maxLines, 100);
    assert.deepEqual(contract?.tests?.requireFor, ["src/api.ts"]);
    assert.deepEqual(contract?.tests?.include, ["tests/**/*.test.ts", "tests/api.test.ts"]);
    assert.deepEqual(contract?.tests?.exclude, ["src/**/*.d.ts"]);
    assert.equal(script.remaining.length, 0);
  });

  it("leaves the policy unwritten when confirmation is declined", async () => {
    const script = scriptedPrompt(["", "", "", "", "", "", "", "no"]);
    const contract = await collectInteractiveContract(changes, script.prompt, "Already supplied");
    assert.equal(contract, undefined);
    assert.match(script.written.join(""), /Already supplied/u);
  });

  it("rejects a path number not shown to the user", async () => {
    const script = scriptedPrompt(["", "4"]);
    await assert.rejects(
      collectInteractiveContract(changes, script.prompt),
      /Invalid changed path number: 4/u,
    );
  });
});
