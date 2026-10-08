#!/usr/bin/env node

import process from "node:process";
import { EnvironmentGitHubActionRuntime } from "./action-runtime.js";
import { runGitHubAction } from "./run-action.js";

const runtime = new EnvironmentGitHubActionRuntime(process.env);

try {
  const result = await runGitHubAction(runtime);
  if (result.qualityGateFailed) {
    runtime.error(result.message ?? "IntentPatch quality gate failed");
    process.exitCode = 1;
  }
} catch (error) {
  runtime.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
