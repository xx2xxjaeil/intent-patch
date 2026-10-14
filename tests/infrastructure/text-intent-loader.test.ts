import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { TextIntentLoader } from "../../src/infrastructure/config/text-intent-loader.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("TextIntentLoader", () => {
  it("reads text and rejects blank, oversized, or symbolic-link requests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "intentpatch-intent-loader-"));
    directories.push(directory);
    await writeFile(join(directory, "request.md"), "  Implement account deletion  \n");
    await writeFile(join(directory, "blank.md"), "  \n");
    await writeFile(join(directory, "large.md"), "x".repeat(65_537));
    await symlink(join(directory, "request.md"), join(directory, "link.md"));
    const outside = await mkdtemp(join(tmpdir(), "intentpatch-outside-intent-"));
    directories.push(outside);
    await writeFile(join(outside, "request.md"), "Hidden text\n");
    await symlink(outside, join(directory, "escape"));
    const loader = new TextIntentLoader();
    assert.equal(await loader.load(directory, "request.md"), "Implement account deletion");
    await assert.rejects(() => loader.load(directory, "blank.md"), /blank/);
    await assert.rejects(() => loader.load(directory, "large.md"), /64 KiB/);
    await assert.rejects(() => loader.load(directory, "link.md"), /regular file/);
    await assert.rejects(
      () => loader.load(directory, "escape/request.md"),
      /outside the repository/,
    );
  });
});
