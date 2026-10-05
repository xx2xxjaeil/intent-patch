import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChangeSource } from "../../src/application/ports/change-source.js";
import { AnalyzeChanges } from "../../src/application/use-cases/analyze-changes.js";
import { createChangeSet } from "../../src/domain/change.js";

describe("AnalyzeChanges", () => {
  it("uses HEAD and the working tree by default", async () => {
    const changes = createChangeSet([]);
    let receivedTarget: Parameters<ChangeSource["collect"]>[0] | undefined;
    const useCase = new AnalyzeChanges({
      collect: async (target) => {
        receivedTarget = target;
        return changes;
      },
    });

    const report = await useCase.execute();

    assert.deepEqual(receivedTarget, { baseRef: "HEAD" });
    assert.deepEqual(report, { target: { baseRef: "HEAD" }, changes });
  });

  it("normalizes an explicit comparison range", async () => {
    const changes = createChangeSet([]);
    let receivedTarget: Parameters<ChangeSource["collect"]>[0] | undefined;
    const useCase = new AnalyzeChanges({
      collect: async (target) => {
        receivedTarget = target;
        return changes;
      },
    });

    await useCase.execute({ baseRef: " main ", headRef: " feature/account " });

    assert.deepEqual(receivedTarget, {
      baseRef: "main",
      headRef: "feature/account",
    });
  });

  it("rejects references that Git could interpret as options", async () => {
    const useCase = new AnalyzeChanges({
      collect: async () => createChangeSet([]),
    });

    await assert.rejects(() => useCase.execute({ baseRef: "--stat" }), /must not start/);
  });
});
