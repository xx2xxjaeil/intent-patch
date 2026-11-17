import assert from "node:assert/strict";
import { it } from "node:test";
import { parseDecisionRecords } from "../../src/infrastructure/config/json-decision-record-loader.js";

const entry = {
  id: "stock-reservation",
  question: "When should stock be reserved?",
  options: [
    {
      id: "before",
      title: "Before payment",
      benefits: ["Avoid overselling"],
      tradeoffs: ["Needs expiry"],
    },
    { id: "after", title: "After payment", benefits: ["Simple"], tradeoffs: ["Can oversell"] },
  ],
  selectedOptionId: "before",
  rationale: "Inventory is scarce.",
  relatedPaths: ["src/stock.ts"],
};

it("accepts a versioned decision file and rejects ambiguous or malformed records", () => {
  assert.equal(
    parseDecisionRecords({ version: 1, decisions: [entry] })[0]?.id,
    "stock-reservation",
  );
  assert.throws(() => parseDecisionRecords({ version: 1, decisions: [entry, entry] }), /unique/u);
  assert.throws(
    () =>
      parseDecisionRecords({ version: 1, decisions: [{ ...entry, selectedOptionId: "other" }] }),
    /must match/u,
  );
  assert.throws(
    () => parseDecisionRecords({ version: 1, decisions: [{ ...entry, extra: "unsafe" }] }),
    /Unknown field/u,
  );
  assert.throws(
    () =>
      parseDecisionRecords({
        version: 1,
        decisions: [{ ...entry, relatedPaths: ["/etc/passwd"] }],
      }),
    /repository-relative/u,
  );
});
