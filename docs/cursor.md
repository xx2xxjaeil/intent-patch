# Cursor Hook integration

IntentPatch can analyze a completed local Cursor Agent generation against its original prompt. The adapter is opt-in, deterministic, and does not call an AI API, require an API key, or add a paid service.

Install IntentPatch in the repository being analyzed with `npm install --save-dev intentpatch@^0.7.0`. Copy [the example configuration](./examples/cursor-hooks.json) into that repository as `.cursor/hooks.json`, replace both `/absolute/path/to/project` placeholders with the repository's actual absolute path, and merge with any existing hooks. The example is POSIX-style; on Windows, quote/escape an absolute script path for PowerShell and JSON. To use a source checkout instead, run `npm ci && npm run build` there and point the example at its `dist/presentation/cli/main.js`.

The event names, common input fields, and output behavior follow the [official Cursor Hooks guide](https://cursor.com/docs/hooks). This adapter targets one local Git repository; it does not claim support for a remote cloud workspace.

How it works:

1. `beforeSubmitPrompt` stores the prompt and starting `HEAD` in an owner-only file under Git metadata. It returns `{"continue":true}`.
2. On a `stop` event with `status: "completed"`, IntentPatch consumes that state, analyzes the change, and writes a self-contained HTML report to `.git/intentpatch-reports/<hash>.html`. It returns `{}` and prints a count-only summary plus the report path to the Hook's stderr/output log. For example: `IntentPatch: 1 files changed; 0 findings (high 0, medium 0, low 0). Report: .../.git/intentpatch-reports/<hash>.html`
3. Aborted or errored generations discard their state and create no report. New completed generations in the same conversation replace its previous HTML report.

Cursor's `stop` output only supports `followup_message`, which would automatically submit another message. IntentPatch deliberately does **not** use it. Therefore the report is **not inserted as a new chat message or card**; open the reported HTML path in a browser. The exact visibility of stderr depends on the Cursor Hook UI.

Prompt state and the HTML report are plain text, **not encrypted**, but kept outside the working tree under Git metadata with owner-only permissions where supported. The report includes the original prompt, so never put credentials in prompts and do not publish the report. Delete `.git/intentpatch-hooks/` and `.git/intentpatch-reports/` manually when no longer needed. Capture requires an existing `HEAD`; input is limited to 256 KiB and the prompt to 64 KiB. A workspace with multiple roots is rejected rather than choosing a repository silently. Moving a generation to a different repository is unsupported.
