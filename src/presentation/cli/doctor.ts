import { diagnoseContract } from "../../application/services/diagnose-contract.js";
import { JsonChangeContractLoader } from "../../infrastructure/config/json-change-contract-loader.js";
import { NodeCommandRunner } from "../../infrastructure/process/command-runner.js";
import type { DoctorCommandOptions } from "./arguments.js";

export async function runDoctor(options: DoctorCommandOptions): Promise<string> {
  const git = new NodeCommandRunner();
  try {
    await git.run({
      executable: "git",
      arguments: ["rev-parse", "--verify", "HEAD"],
      cwd: options.workingDirectory,
    });
  } catch {
    throw new Error(
      "doctor needs a Git repository with at least one commit. Run git status and create an initial commit first.",
    );
  }

  const contract = await new JsonChangeContractLoader().load(
    options.workingDirectory,
    options.configurationPath,
  );
  const checks = diagnoseContract(contract);
  const lines = [
    "IntentPatch doctor",
    "",
    `Change Contract: ${contract === undefined ? "not found" : "loaded"}`,
    ...checks.map(
      (check) => `${check.enabled ? "ON " : "OFF"}  ${check.label}\n     ${check.detail}`,
    ),
    "",
    contract === undefined
      ? "Next: run intentpatch init --interactive, then review .intentpatch.json."
      : checks.some((check) => !check.enabled)
        ? "Next: edit the Change Contract to enable the checks you need."
        : "Next: run intentpatch analyze --format html --output ../intentpatch-report.html.",
    "doctor checks configuration, not whether the code is correct or every file can be analyzed.",
  ];
  return `${lines.join("\n")}\n`;
}
