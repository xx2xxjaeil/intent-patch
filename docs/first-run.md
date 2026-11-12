# First run: from intent to a reviewable diff

Run these commands **inside the Git repository you want to review**. The repository must have at
least one commit and a change relative to `HEAD`. Node.js 20+ and Git are required.

```bash
npx intentpatch init --intent "Remove the user export" --include "src/**" --allow ".intentpatch.json"
# Review and edit .intentpatch.json so the expected paths describe your actual request.
npx intentpatch doctor
npx intentpatch analyze --format html --output ../intentpatch-report.html
```

For a guided setup, run `npx intentpatch init --interactive` instead of the first command.
Select changed paths by number, add globs for future paths, and review the JSON before confirming.
The wizard needs a terminal and an existing Git commit. Include `.intentpatch.json` among allowed
paths if you will analyze the new contract itself before committing it.

`doctor` checks that the repository has a commit and loads the same Change Contract as `analyze`.
It lists core Git/dependency/JS/TS analysis, expected-scope checks, change budgets, and related-test
checks as ON or OFF, with a next step for inactive checks. Pass `--config custom.json` to inspect a
different contract or `--cwd /path/to/repository` to inspect another repository. It reports
configuration readiness, not the result or coverage of a patch; run `analyze` for that.

Open `../intentpatch-report.html` in a browser. Writing the generated report beside the repository
prevents it from appearing as a changed source file on the next run. Findings with a verified
source location link to the exact line when it is present in the bounded Git diff preview;
otherwise they link to the file preview. The preview shows up to 30 changed files and 160 patch
lines per file; it says when a binary or untracked file has no text patch. The full diff remains
available through Git. HTML is a
local file and needs no server or API key. Source locations identify symbol declarations for
supported code findings, including the previous revision for removed symbols. File-wide findings
do not claim a source line. Line links are included in v0.13.0 and later.

`init` creates `.intentpatch.json` only when it does not already exist. The example allows that
file because the new contract itself appears as a Git change. It does not infer scope from
the English or Korean intent: edit `scope.include` and `scope.allow` yourself. If you omit
`--include`, scope checks remain disabled until you set an expected path. Do not commit a contract
that contains sensitive request text.

To review a completed branch or pull request locally, compare explicit refs:

```bash
npx intentpatch analyze --base main --head HEAD --format html --output ../intentpatch-report.html
```

`base...head` follows Git's merge-base comparison. Fetch both refs if a shallow checkout is
missing history. The report distinguishes findings from analysis notes: a finding is a review
candidate, not proof that the change is wrong.

## If the result is surprising

| Symptom | Check |
| --- | --- |
| `Git command failed` | Run `git status` in the target repository, confirm both refs exist, and fetch missing history. |
| No changed files | Check `git diff HEAD` or the supplied `--base` and `--head`. New untracked files need `git add -N` for Git to show a patch. |
| No scope finding | Check `.intentpatch.json` and set `scope.include`; intent text alone does not define expected paths. |
| `doctor` shows OFF | Follow its suggested Change Contract setting, then run `doctor` again. |
| A finding looks wrong | Follow its file diff link, then inspect the full `git diff` and related tests. |
| HTML file not found | `--output` is resolved from the shell's current directory; the CLI prints its full destination. |

For an entirely reproducible example based on actual commits in this repository, see the
[self-repository case study](./real-world-evaluation.md).
