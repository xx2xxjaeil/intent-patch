import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { writeReportFile } from "../../src/presentation/cli/report-file-writer.js";

describe("writeReportFile", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  it("writes a relative output path beneath the invocation directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "intentpatch-report-"));
    temporaryDirectories.push(directory);

    const destination = await writeReportFile("<html>report</html>\n", "report.html", directory);

    assert.equal(destination, join(directory, "report.html"));
    assert.equal(await readFile(destination, "utf8"), "<html>report</html>\n");
  });
});
