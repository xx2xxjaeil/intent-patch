import { performance } from "node:perf_hooks";
import process from "node:process";

const { analyzeRepository } = await import(
  new URL("../dist/presentation/analyze-repository.js", import.meta.url)
);

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!value || !["--cwd", "--base", "--head", "--iterations"].includes(key)) {
      throw new Error(
        "Usage: node scripts/benchmark-analysis.mjs --cwd <repo> --base <ref> --head <ref> [--iterations 3]",
      );
    }
    options[key.slice(2)] = value;
  }
  const iterations = Number(options.iterations ?? 3);
  if (
    !options.cwd ||
    !options.base ||
    !options.head ||
    !Number.isInteger(iterations) ||
    iterations < 1
  ) {
    throw new Error("Expected --cwd, --base, --head, and a positive integer --iterations.");
  }
  return { ...options, iterations };
}

const options = parseArguments(process.argv.slice(2));
const durations = [];
let peakRss = process.memoryUsage().rss;
let filesChanged = 0;
let findings = 0;
for (let index = 0; index < options.iterations; index += 1) {
  const monitor = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 5);
  const start = performance.now();
  try {
    const report = await analyzeRepository({
      workingDirectory: options.cwd,
      baseRef: options.base,
      headRef: options.head,
    });
    durations.push(Math.round(performance.now() - start));
    filesChanged = report.changes.summary.filesChanged;
    findings = report.findings.summary.total;
  } finally {
    clearInterval(monitor);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
}
const sorted = [...durations].sort((a, b) => a - b);
process.stdout.write(
  `${JSON.stringify(
    {
      benchmark: "analyzeRepository",
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      iterations: options.iterations,
      milliseconds: { runs: durations, median: sorted[Math.floor(sorted.length / 2)] },
      peakProcessRssMiB: Math.round(peakRss / 1024 / 1024),
      filesChanged,
      findings,
    },
    null,
    2,
  )}\n`,
);
