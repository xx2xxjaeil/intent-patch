# Self-repository case study

IntentPatch was run against three changes in its own Git history. This is a self-repository case
study, not an independent evaluation. These are real commits, not hand-written demo findings.
The checked-in [HTML example](./examples/intent-input-change.html) is
the report for the request-input commit. Clone this repository and open the HTML file locally to
see the standalone dashboard; GitHub's file viewer may display the HTML source instead.

Use the current source build and full Git history to reproduce the examples:

```bash
npm ci
npm run build
node dist/presentation/cli/main.js analyze \
  --base 1cc489b^ --head 1cc489b \
  --format html --output intentpatch-report.html
```

For a terminal or machine-readable report, replace `--format html` with `--format text` or
`--format json` and omit `--output`. These commit IDs belong to this repository; a shallow clone
must fetch their history first. Counts below were measured with the source after PR #11 was merged.

| Compared change | Files | Findings | Human review |
| --- | ---: | --- | --- |
| `3aed45e^` → `3aed45e`: npm workspace analysis | 7 | 1 medium: duplicated `isRecord` | Actionable: the same guard already existed in another rule; it was later consolidated. |
| `1cc489b^` → `1cc489b`: request input | 15 | 1 high: required `GitHubActionInputs.intentFromPrBody` added; 1 medium: duplicated `isRecord` | Actionable: adding a required member can break existing TypeScript consumers, and the guard can be reused. Both were addressed in `81b40f9`. |
| `fbf59fb` → `81b40f9`: entire PR #11 feature branch | 39 | 1 low: `PnpmWorkspaceParser` has one implementation; no high or medium findings | Accepted review candidate: the port keeps YAML parsing out of the application layer. A single implementation is not automatically excessive. |

The second case's HTML report was generated with:

```bash
node dist/presentation/cli/main.js analyze \
  --base 1cc489b^ --head 1cc489b \
  --format html --output docs/examples/intent-input-change.html
```

The commit `81b40f9` alone changes an exported member from required to optional. Comparing just
that intermediate commit to its parent can still produce a high finding: consumers that read a
previously required property may have to handle `undefined`. The appropriate comparison for the
whole request is the pre-feature base (`fbf59fb`) against the final feature head (`81b40f9`).
That comparison has no high finding. The [self-contained integration regression tests](../tests/integration/real-change-evaluation.test.ts)
recreate the required-member and duplicated-guard patterns in temporary Git repositories, so
they also run in CI's shallow checkout.

## Review limits

- In these three cases, the high and medium findings corresponded to changes that were later
  corrected. No high/medium false positive was confirmed. The low abstraction finding is a review
  prompt, not a defect, and was deliberately retained.
- This is a small, non-random sample of one repository, not a precision or recall benchmark.
  No claim is made about missed findings in other projects.
- The analyzer does not establish runtime dependency usage, execute changed code, or infer request
  scope from natural language. A reviewer must still inspect the diff and tests.
