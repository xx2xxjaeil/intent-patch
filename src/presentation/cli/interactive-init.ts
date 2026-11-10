import { createInterface } from "node:readline/promises";
import type { FileChange } from "../../domain/change.js";
import { type ChangeContract, createChangeContract } from "../../domain/change-contract.js";

const maximumDisplayedPaths = 100;

interface Prompt {
  question(text: string): Promise<string>;
  write(text: string): void;
}

/** 실제 변경 경로를 제시하되 범위·테스트 정책은 사용자가 명시적으로 선택한다. */
export async function collectInteractiveContract(
  changes: readonly FileChange[],
  prompt: Prompt,
  initialIntent?: string,
): Promise<ChangeContract | undefined> {
  const intent =
    initialIntent ?? (await prompt.question("Request (optional; avoid secrets): ")).trim();
  const paths = changes.slice(0, maximumDisplayedPaths).map((change) => change.path);
  prompt.write("Changed paths (HEAD → working tree):\n");
  if (paths.length === 0)
    prompt.write("  None. Enter patterns below to configure future changes.\n");
  paths.forEach((path, index) => {
    prompt.write(`  ${index + 1}. ${path}\n`);
  });
  if (changes.length > paths.length) {
    prompt.write(
      `  ${changes.length - paths.length} more paths omitted; enter their patterns manually.\n`,
    );
  }
  prompt.write("Choose paths yourself; the request text does not determine scope.\n");

  const include = await askPaths(prompt, paths, "Expected");
  const allow = await askPaths(prompt, paths, "Allowed exception");
  const maxFiles = await askBudget(prompt, "Maximum changed files (blank to skip): ");
  const maxLines = await askBudget(prompt, "Maximum measured changed lines (blank to skip): ");

  let tests: { requireFor: string[]; include: string[]; exclude: string[] } | undefined;
  if (
    (await prompt.question("Check for related test changes? [y/N]: ")).trim().toLowerCase() === "y"
  ) {
    const requireFor = await askPaths(prompt, paths, "Source requiring tests");
    const testFiles = await askPaths(prompt, paths, "Related test");
    if (requireFor.length === 0 || testFiles.length === 0) {
      throw new Error("Test checks require at least one source and one test path pattern.");
    }
    const exclude = splitPatterns(
      await prompt.question("Excluded source patterns (comma-separated; blank to skip): "),
    );
    tests = { requireFor, include: testFiles, exclude };
  }

  const contract = createChangeContract({
    ...(intent === "" ? {} : { intent }),
    scope: {
      include,
      allow,
      ...(maxFiles === undefined ? {} : { maxFiles }),
      ...(maxLines === undefined ? {} : { maxLines }),
    },
    ...(tests === undefined ? {} : { tests }),
  });
  prompt.write(`${JSON.stringify(contract, null, 2)}\n`);
  const confirmation = (await prompt.question("Create .intentpatch.json with this policy? [y/N]: "))
    .trim()
    .toLowerCase();
  return confirmation === "y" || confirmation === "yes" ? contract : undefined;
}

/** 터미널 I/O는 대화형 입력의 경계에서만 열고 반드시 닫는다. */
export async function promptForContract(
  changes: readonly FileChange[],
  initialIntent?: string,
): Promise<ChangeContract | undefined> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await collectInteractiveContract(
      changes,
      {
        question: (text) => terminal.question(text),
        write: (text) => process.stdout.write(text),
      },
      initialIntent,
    );
  } finally {
    terminal.close();
  }
}

async function askPaths(
  prompt: Prompt,
  candidates: readonly string[],
  label: string,
): Promise<string[]> {
  const selected = await prompt.question(
    `${label} changed path numbers (space-separated; blank to skip): `,
  );
  const paths = selected.trim() === "" ? [] : selectPaths(selected, candidates);
  const extra = splitPatterns(
    await prompt.question(`${label} additional paths/globs (comma-separated; blank to skip): `),
  );
  return [...paths, ...extra];
}

function selectPaths(value: string, candidates: readonly string[]): string[] {
  return value
    .trim()
    .split(/[\s,]+/u)
    .map((item) => {
      const index = Number(item);
      if (!/^[1-9]\d*$/u.test(item) || index > candidates.length) {
        throw new Error(`Invalid changed path number: ${item}`);
      }
      return candidates[index - 1] ?? "";
    });
}

function splitPatterns(value: string): string[] {
  return value
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== "");
}

async function askBudget(prompt: Prompt, question: string): Promise<number | undefined> {
  const value = (await prompt.question(question)).trim();
  if (value === "") return undefined;
  const number = Number(value);
  if (!/^(0|[1-9]\d*)$/u.test(value) || !Number.isSafeInteger(number)) {
    throw new Error("Budget must be a non-negative integer.");
  }
  return number;
}
