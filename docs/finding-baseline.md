# Finding baseline

IntentPatch can keep a reviewed finding visible without letting it fail the quality gate. Put
`.intentpatch-baseline.json` in the repository, or pass `--baseline <path>` to the CLI / `baseline`
to the GitHub Action. The file is optional.

```json
{
  "version": 1,
  "entries": [
    {
      "ruleId": "api/public-signature-changed",
      "file": "src/api.ts",
      "evidence": { "symbolName": "deleteUser" },
      "reason": "The v2 migration has a separate consumer update",
      "expires": "2026-12-31"
    }
  ]
}
```

Use the exact rule ID, repository-relative file path, and at least one scalar value from the
finding's JSON `evidence`. An entry must identify at most one finding; ambiguous and overlapping
entries cause an error. `reason` and `expires` are required. The expiry date is inclusive in UTC:
after that day, the finding becomes active again. Both accepted and expired entries remain visible
in reports. The baseline file does not delete or change the underlying finding.

For pull requests, the Action adds a high-severity finding when the PR changes the Change Contract
or baseline file used for its own analysis. This policy finding is added after baseline matching,
so it cannot be suppressed by the same PR. Review and merge policy changes separately before
relying on the PR gate. This detects changed policy files; it does not establish that a PR's code
is correct or prevent a maintainer from deliberately changing the workflow itself. For an
enforcement workflow, pin the Action to a released tag or commit SHA.
