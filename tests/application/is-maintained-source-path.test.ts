import assert from "node:assert/strict";
import { it } from "node:test";
import { isMaintainedSourcePath } from "../../src/application/services/is-maintained-source-path.js";

it("excludes generated files without hiding maintained JavaScript", () => {
  assert.equal(isMaintainedSourcePath("src/index.js"), true);
  assert.equal(isMaintainedSourcePath("tests/distinct.test.ts"), true);
  for (const path of [
    "action-dist/index.cjs",
    "packages/app/dist/index.js",
    "node_modules/a/index.js",
  ]) {
    assert.equal(isMaintainedSourcePath(path), false);
  }
});
