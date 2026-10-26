# Codex Hook integration

IntentPatch can compare a local Codex turn with the prompt that started it. This adapter is opt-in and uses the existing deterministic analyzer. It does not call an AI API or require an API key.

Install IntentPatch in the repository being analyzed with `npm install --save-dev intentpatch@^0.7.0`. Copy [the example configuration](./examples/codex-hooks.json) into that repository as `.codex/hooks.json`, replace all three `/absolute/path/to/project` placeholders with the actual absolute path to the repository, and merge with any existing hooks. Review and trust the project Hook in Codex with `/hooks`; project-local hooks require a trusted project. The example is POSIX-style. On Windows, use a valid absolute script path and quote/escape it for your shell and JSON file. To use a source checkout instead, run `npm ci && npm run build` there and point the example at its `dist/presentation/cli/main.js`.

The event names, JSON input fields, and `systemMessage` output follow the [official Codex Hooks guide](https://learn.chatgpt.com/docs/hooks). Hooks run locally when Codex invokes them; availability can differ in cloud-orchestrated workflows.

How it works:

1. `UserPromptSubmit` saves the prompt and current `HEAD` in an owner-only file under Git metadata. It produces no output.
2. `Stop` consumes that state, analyzes the Git change, and returns a count-only `systemMessage`. For example: `IntentPatch: 1 files changed; 0 findings (high 0, medium 0, low 0).`
3. `Interrupt` clears an unfinished turn. A second `Stop` cannot reuse already-consumed state. The hook does not block the agent or create another model turn.

Only a summary is shown through the Hook; run `intentpatch analyze` separately for the full report. Prompt state is plain text, **not encrypted**, and stored under `.git/intentpatch-hooks/` with owner-only permissions where supported. A crash can leave state behind; delete that directory manually if needed. Never place credentials in prompts. The input limit is 256 KiB, the prompt limit is 64 KiB, and capture requires a Git repository with an existing `HEAD`. The same turn can move between directories of one repository, but not to another repository.
