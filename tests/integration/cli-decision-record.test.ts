import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const cli = fileURLToPath(new URL("../../src/presentation/cli/main.ts", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("scaffolds a decision file without overwriting it and connects authored choices to a real diff", async () => {
  const repository = await mkdtemp(join(tmpdir(), "intentpatch-decision-"));
  directories.push(repository);
  await executeFile("git", ["init", "-q", repository]);
  await writeFile(join(repository, "stock.ts"), "export const stock = 1;\n");
  await executeFile("git", ["add", "stock.ts"], { cwd: repository });
  await executeFile(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"],
    { cwd: repository },
  );
  await writeFile(join(repository, "stock.ts"), "export const stock = 2;\n");

  const run = (args: readonly string[]) =>
    executeFile("node", ["--import", "tsx", cli, ...args, "--cwd", repository], {
      cwd: projectRoot,
    });
  await run(["decision", "init"]);
  const destination = join(repository, ".intentpatch-decisions.json");
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), { version: 1, decisions: [] });
  await assert.rejects(run(["decision", "init"]), /already exists/u);

  await writeFile(
    destination,
    JSON.stringify({
      version: 1,
      decisions: [
        {
          id: "stock-choice",
          question: "Reserve <stock> before payment?",
          options: [
            {
              id: "before",
              title: "Before payment",
              benefits: ["Avoid overselling"],
              tradeoffs: ["Needs expiry"],
            },
            {
              id: "after",
              title: "After payment",
              benefits: ["Simple"],
              tradeoffs: ["Can oversell"],
            },
          ],
          selectedOptionId: "before",
          rationale: "Scarce stock needs a hold.",
          relatedPaths: ["stock.ts", "README.md"],
        },
      ],
    }),
  );

  const json = JSON.parse((await run(["analyze", "--format", "json"])).stdout) as {
    decisions: Array<{ changedPaths: string[] }>;
  };
  assert.deepEqual(json.decisions[0]?.changedPaths, ["stock.ts"]);
  const html = (await run(["analyze", "--format", "html"])).stdout;
  assert.match(html, /Reserve &lt;stock&gt; before payment/u);
  assert.match(html, /href="#file-\d+">stock\.ts<\/a>/u);
  assert.doesNotMatch(html, /href="#file-\d+">README\.md<\/a>/u);
  assert.match(html, /not proof that the chosen approach is correct/u);
});
