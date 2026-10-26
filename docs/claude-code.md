# Claude Code Hook integration

IntentPatch can analyze each completed Claude Code turn against the request that started it. This adapter is **opt-in** and runs locally; it does not call Claude, OpenAI, or another API.

The integration is available in **v0.6.0 and later**. To test an unreleased source checkout instead, run `npm ci && npm run build` and replace the example's script path with the absolute path to its `dist/presentation/cli/main.js`.

Install IntentPatch in the repository being analyzed (`npm install --save-dev intentpatch@^0.7.0`), then copy [the example settings](./examples/claude-code-hooks.json) into that repository's `.claude/settings.json`. Merge it with existing settings rather than replacing unrelated hooks. The example calls `node` directly, so it also works on Windows where npm's `.cmd` shim cannot be launched in exec form. Verify the hooks in Claude Code with `/hooks`.

The event names, stdin fields, exec-form `args`, and `systemMessage` output follow the [Claude Code Hook reference](https://code.claude.com/docs/en/hooks).

How it works:

1. `UserPromptSubmit` saves the prompt and the current `HEAD` commit in an owner-only file under the repository's Git metadata. It writes nothing to stdout.
2. `Stop` consumes that file and analyzes changes since the captured commit, using the prompt as the report's intent. A small finding-count summary is returned as a Claude Code `systemMessage`; the prompt itself is not printed.
3. `StopFailure` and `SessionEnd` remove any remaining state. An empty diff produces no message.

The state is plain text on the local disk, protected by directory/file permissions where supported, **not encrypted**. A crash or interruption can leave it until a later cleanup; remove `.git/intentpatch-hooks/` manually if needed. Do not put credentials in prompts. Hook commands run with your user permissions, so inspect the settings before enabling them. This integration does not block the agent or change its output; use the standalone CLI or GitHub Action for a full report and quality gate.

Limitations: only the latest prompt for a session is kept; independently started agent turns may replace it. The capture requires an existing Git `HEAD` commit. The hook can follow directory changes within the same repository, but not a turn that moves to another repository. If Claude commits during the turn, the saved starting commit still anchors the comparison. Input is limited to 256 KiB and the prompt to 64 KiB.
