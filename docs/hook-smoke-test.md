# Agent Hook smoke test

The packaged-CLI integration test builds an npm tarball, installs it in a fresh Git repository,
and sends real JSON through the **installed** `intentpatch` executable for Codex, Claude Code,
and Cursor. It verifies the CLI summary, Cursor's private HTML report, and consumed hook state.
Run it with `node --import tsx --test tests/integration/packaged-cli.test.ts` after `npm ci`.
The three adapter suites also test committed turns, interrupted/aborted turns, permission bits,
and report replacement using temporary Git repositories. These tests simulate Hook events; they
do **not** prove that a particular installed agent application invokes a project Hook correctly.

Before a release, perform one live application check for each installed agent:

1. Create a disposable Git repository with one committed source file. Install the candidate
   tarball (or the released package) and configure the Hook using the relevant
   [Codex](./codex.md), [Claude Code](./claude-code.md), or [Cursor](./cursor.md) guide.
2. In the agent application, submit a harmless request that changes the source file. Confirm
   the reported changed-file count matches `git diff --name-only` and that no original prompt
   appears in the Hook's summary or error output.
3. In Cursor, open the HTML report path from the Hook log. Confirm that the request and the
   changed file appear, that path and severity filters work, and that graph links navigate to
   the corresponding report row.
4. Repeat with an interrupted/aborted generation. Confirm no stale state is reused on the next
   turn. Inspect `.git/intentpatch-hooks/` and `.git/intentpatch-reports/`; delete those private
   test artifacts when finished.

Record the agent version, operating system, observed Hook output, report path, and any mismatch
before marking a live check complete. Do not use real secrets in prompts or publish Cursor's
private HTML report. A local package test is not a substitute for this live checklist.
