import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compareEvaluationLabels, summarizeEvaluation } from "./evaluation-metrics.mjs";

const executeFile = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../dist/presentation/cli/main.js", import.meta.url));
const manifestUrl = new URL("../docs/external-evaluation-cases.json", import.meta.url);

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  validateManifest(manifest);

  const results = [];
  for (const evaluationCase of manifest.cases) {
    const repository = join(options.repositories, evaluationCase.repository);
    await verifyCommit(repository, evaluationCase.head);
    const report = await analyze(repository, evaluationCase.head);
    const actual = report.findings.items
      .filter((finding) => finding.ruleId === manifest.focusRule)
      .map((finding) => ({ file: finding.file, symbolName: finding.evidence.symbolName }));
    results.push({
      id: evaluationCase.id,
      repository: evaluationCase.repository,
      head: evaluationCase.head,
      ...compareEvaluationLabels(evaluationCase.expected, actual),
    });
  }

  const output = {
    focusRule: manifest.focusRule,
    cases: results,
    totals: summarizeEvaluation(results),
  };
  process.stdout.write(options.json ? `${JSON.stringify(output, null, 2)}\n` : formatText(output));
  if (output.totals.missing > 0 || output.totals.unexpected > 0) {
    process.exitCode = 1;
  }
}

function parseArguments(arguments_) {
  let repositories;
  let json = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (
      argument === "--repositories" &&
      arguments_[index + 1] !== undefined &&
      !arguments_[index + 1].startsWith("--")
    ) {
      repositories = resolve(arguments_[++index]);
    } else if (argument === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown or incomplete option: ${argument}`);
    }
  }
  if (repositories === undefined) {
    throw new Error("Usage: npm run evaluate:external -- --repositories <clone-parent> [--json]");
  }
  return { repositories, json };
}

function validateManifest(manifest) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.focusRule !== "api/exported-symbol-removed" ||
    typeof manifest.repositories !== "object" ||
    manifest.repositories === null ||
    !Array.isArray(manifest.cases)
  ) {
    throw new Error("Unsupported external evaluation manifest");
  }
  const ids = new Set();
  for (const evaluationCase of manifest.cases) {
    if (
      typeof evaluationCase.id !== "string" ||
      ids.has(evaluationCase.id) ||
      !/^[a-z0-9-]+$/.test(evaluationCase.repository) ||
      !Object.hasOwn(manifest.repositories, evaluationCase.repository) ||
      typeof manifest.repositories[evaluationCase.repository] !== "string" ||
      !/^[0-9a-f]{40}$/.test(evaluationCase.head) ||
      !Array.isArray(evaluationCase.expected) ||
      typeof evaluationCase.reason !== "string" ||
      evaluationCase.reason.length === 0
    ) {
      throw new Error(`Invalid external evaluation case: ${evaluationCase.id ?? "unknown"}`);
    }
    ids.add(evaluationCase.id);
  }
}

async function verifyCommit(repository, head) {
  try {
    const { stdout } = await executeFile("git", ["rev-parse", "--verify", `${head}^{commit}`], {
      cwd: repository,
    });
    if (stdout.trim() !== head) throw new Error("Commit hash mismatch");
    await executeFile("git", ["rev-parse", "--verify", `${head}^`], { cwd: repository });
  } catch {
    throw new Error(`Missing commit ${head} and its parent in ${repository}; use a full clone`);
  }
}

async function analyze(repository, head) {
  const { stdout } = await executeFile(
    process.execPath,
    [cliPath, "analyze", "--cwd", repository, "--base", `${head}^`, "--head", head, "--json"],
    { cwd: projectRoot, maxBuffer: 20 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

function formatText(output) {
  const lines = [`External evaluation: ${output.focusRule}`];
  for (const result of output.cases) {
    const status = result.missing.length === 0 && result.unexpected.length === 0 ? "PASS" : "FAIL";
    lines.push(
      `${status} ${result.id}: matched ${result.matched.length}, missing ${result.missing.length}, unexpected ${result.unexpected.length}`,
    );
    for (const label of result.missing) lines.push(`  missing: ${label.file} ${label.symbolName}`);
    for (const label of result.unexpected) {
      lines.push(`  unexpected: ${label.file} ${label.symbolName}`);
    }
  }
  lines.push(
    `Totals: ${output.totals.matched} matched, ${output.totals.missing} missing, ${output.totals.unexpected} unexpected`,
  );
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
