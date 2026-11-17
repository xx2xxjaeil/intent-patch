# Implementation decision records

IntentPatch can display a developer's implementation choice beside the change evidence. It does
not generate alternatives or decide which option is best. The author supplies the question,
alternatives, tradeoffs, and reason; IntentPatch links exact declared paths to files that actually
changed in the selected Git comparison.

Run `intentpatch decision init` in the repository to create an empty
`.intentpatch-decisions.json`. It will not overwrite an existing file. Add a decision like this:

```json
{
  "version": 1,
  "decisions": [
    {
      "id": "inventory-reservation",
      "question": "When should inventory be reserved during checkout?",
      "options": [
        {
          "id": "before-payment",
          "title": "Reserve before payment",
          "benefits": ["Prevents overselling while payment is in progress"],
          "tradeoffs": ["Requires expiration and release of abandoned reservations"]
        },
        {
          "id": "after-payment",
          "title": "Reserve after payment",
          "benefits": ["Keeps the payment flow simpler"],
          "tradeoffs": ["Payment can succeed when stock is no longer available"]
        }
      ],
      "selectedOptionId": "before-payment",
      "rationale": "The item has limited stock, so a temporary reservation protects checkout consistency.",
      "relatedPaths": ["src/checkout/reserve.ts", "src/checkout/reserve.test.ts"]
    }
  ]
}
```

Run `intentpatch analyze --format html --output ../intentpatch-report.html`. The text, JSON, and
HTML reports include the decisions; the GitHub Action Job Summary shows their count. In HTML,
changed paths link to file rows and overlapping active findings link to their finding cards.
`relatedPaths` are exact repository-relative file paths, not globs. A declared path that did not
change is not presented as change evidence. Renamed files can match their previous paths.

Decision records are **author-provided context**. The linked Git paths and findings are observed
facts, but they do not validate the stated benefits, tradeoffs, or rationale. Decision records do
not affect findings or the quality gate. The file is read from the current checkout, even when
analyzing historical Git references, so review it alongside the selected comparison. Do not put
secrets in it; report output can be shared.

The loader accepts a regular file of at most 64 KiB, up to 20 decisions, 2–10 distinct options
per decision, and 1–50 exact related paths. Each option needs at least one benefit and tradeoff;
`selectedOptionId` must match one of its IDs. Invalid or unknown fields fail with an explicit
error instead of being silently ignored.
