import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { JsonChangeContractLoader } from "../../src/infrastructure/config/json-change-contract-loader.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("JsonChangeContractLoader", () => {
  it("returns undefined when the default configuration does not exist", async () => {
    const directory = await createTemporaryDirectory();

    assert.equal(await new JsonChangeContractLoader().load(directory), undefined);
  });

  it("loads and normalizes the default configuration", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(
      join(directory, ".intentpatch.json"),
      JSON.stringify({
        intent: "회원 탈퇴 구현",
        scope: {
          include: ["src/user/**", "tests/user/**"],
          allow: ["package.json"],
          maxFiles: 8,
          maxLines: 300,
        },
      }),
    );

    assert.deepEqual(await new JsonChangeContractLoader().load(directory), {
      intent: "회원 탈퇴 구현",
      scope: {
        include: ["src/user/**", "tests/user/**"],
        allow: ["package.json"],
        maxFiles: 8,
        maxLines: 300,
      },
    });
  });

  it("fails when an explicit file is missing", async () => {
    const directory = await createTemporaryDirectory();

    await assert.rejects(
      () => new JsonChangeContractLoader().load(directory, "missing.json"),
      /file not found/,
    );
  });

  it("reports invalid JSON, unknown fields, and invalid field types", async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, "contract.json");
    const loader = new JsonChangeContractLoader();

    await writeFile(path, "{");
    await assert.rejects(() => loader.load(directory, path), /not valid JSON/);

    await writeFile(path, JSON.stringify({ scope: { includes: ["src/**"] } }));
    await assert.rejects(() => loader.load(directory, path), /Unknown scope field: includes/);

    await writeFile(path, JSON.stringify({ scope: { include: "src/**" } }));
    await assert.rejects(() => loader.load(directory, path), /array of strings/);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "intentpatch-contract-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
