import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { assertMatchingPackageFiles } from "../../scripts/check-published-version.mjs";

describe("published package files", () => {
  it("accepts identical files regardless of archive metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "intentpatch-package-files-"));
    const localRoot = join(root, "local");
    const publishedRoot = join(root, "published");

    try {
      mkdirSync(localRoot);
      mkdirSync(publishedRoot);
      writeFileSync(join(localRoot, "package.json"), '{"version":"0.1.1"}');
      writeFileSync(join(publishedRoot, "package.json"), '{"version":"0.1.1"}');
      const localFiles = [{ path: "package.json", mode: 0o644 }];
      const publishedFiles = [{ path: "package.json", mode: 0o755 }];

      assert.doesNotThrow(() =>
        assertMatchingPackageFiles(
          "intentpatch@0.1.1",
          localFiles,
          publishedFiles,
          localRoot,
          publishedRoot,
        ),
      );

      writeFileSync(join(publishedRoot, "package.json"), '{"version":"0.1.2"}');
      assert.throws(
        () =>
          assertMatchingPackageFiles(
            "intentpatch@0.1.1",
            localFiles,
            publishedFiles,
            localRoot,
            publishedRoot,
          ),
        /different file contents: package.json/,
      );

      assert.throws(
        () =>
          assertMatchingPackageFiles("intentpatch@0.1.1", localFiles, [], localRoot, publishedRoot),
        /different packaged files/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
