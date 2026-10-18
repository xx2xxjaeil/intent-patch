# External repository evaluation

The first exploratory run compared six merged changes from two independent open-source projects.
The focused, reviewed-label evaluation below extends that set to 15 changes. Together they show
what IntentPatch can and cannot establish outside its own repository. Only Git snapshots were
read; the external projects' install, build, and test scripts were not run. The six-case results
were measured on 2026-10-18; the focused evaluation was measured on 2026-10-19. Neither is a
general precision or recall benchmark.

## Reproduce

Use full clones (or fetch the listed commits and their parents) and build IntentPatch itself:

```bash
npm ci
npm run build
git clone https://github.com/sindresorhus/p-queue.git ../p-queue
git clone https://github.com/ai/nanoid.git ../nanoid
node dist/presentation/cli/main.js analyze \
  --cwd ../nanoid \
  --base '0b2cec58ffd5ddc45978bf75a3bab46f53c76128^' \
  --head 0b2cec58ffd5ddc45978bf75a3bab46f53c76128 \
  --format text
```

Replace `--cwd`, `--base`, and `--head` to reproduce another row below. The listed commit is the
head; its first parent is the base. A partial clone may need network access to fetch missing blobs.
No IntentPatch change contract was supplied, so request-scope and test-policy findings were not
expected.

| Project change | Files | Symbol changes | Direct / transitive dependents | Findings | Manual interpretation |
| --- | ---: | ---: | ---: | --- | --- |
| [p-queue #242](https://github.com/sindresorhus/p-queue/pull/242), `a20e1f34b5c82e4e91e5d2e0c8b663e831dc16ab` | 1 | 1 added | 8 / 0 | 0 | Adds an exported type; no removal warning is appropriate. |
| [p-queue #244](https://github.com/sindresorhus/p-queue/pull/244), `87077d0214c203f38d0f36c4efee8172e67bf1c4` | 3 | 1 modified | 1 / 7 | 0 | Performance change with a changed test; no contract break was established. |
| [p-queue #235](https://github.com/sindresorhus/p-queue/pull/235), `e9074f06fff500a13e0ef7c910ff4fc2fe65b01c` | 2 | 1 modified | 6 / 0 | 0 | Abort-listener fix with a changed test; no contract break was established. |
| [nanoid #616](https://github.com/ai/nanoid/pull/616), `0b2cec58ffd5ddc45978bf75a3bab46f53c76128` | 4 | 2 modified | 5 / 0 | 0 | Changes two exported JS declarations and adds non-integer-size tests; no export is removed. |
| [nanoid #618](https://github.com/ai/nanoid/pull/618), `58193a1d3aab9877315c42e995eb94667e0b1a4` | 2 | 0 | 0 / 0 | 0 | CLI validation and its test change; no tracked top-level ESM export changes. |
| [nanoid #609](https://github.com/ai/nanoid/pull/609), `8588e3a0db022b3876a4724e25cce4961e2a47a4` | 1 | 0 | 0 / 0 | 0 | Documentation-only change. |

The first evaluation attempt could not finish any `nanoid` change: a declaration file caused
TypeScript's `transpileModule` to throw because it emits no JavaScript for `.d.ts`. The parser now
uses syntactic diagnostics without emission; a regression test covers valid and malformed
declaration files. The JS/JSX import graph and ESM export tracking then made the `nanoid` cases
measurable. `p-queue` still reports one unavailable configuration file per case because its
package-based `tsconfig` extension is absent in a no-install checkout. This is visible in the
report rather than silently treated as a complete alias graph.

## Curated public-export-removal evaluation

A separate, versioned [case manifest](./external-evaluation-cases.json) contains 15 reviewed
changes from these two repositories, including the six changes above. It scores only the
`api/exported-symbol-removed` rule. Each expected label is a file path and exported name, reviewed
against the Git diff before running the evaluator. Ten labels are expected in two changes:
Nano ID's deleted async entry point and p-queue's removed `AbortError` class. The other 13 changes
should produce no finding for this particular rule; they are not necessarily risk-free.

With full clones in a common parent directory, reproduce the evaluation without installing or
running either external project's dependencies or scripts:

```bash
git clone https://github.com/ai/nanoid.git ../nanoid
git clone https://github.com/sindresorhus/p-queue.git ../p-queue
npm ci
npm run evaluate:external -- --repositories ..
```

The script checks every fixed commit and its parent, builds IntentPatch, runs the CLI against the
Git snapshots, and compares findings with the reviewed labels. `--json` provides a machine-readable
result. A mismatch exits nonzero. On 2026-10-19, all 15 cases matched: **10 expected labels found,
0 missing, 0 unexpected** for the focused rule.

This evaluation exposed a concrete false positive: changing an exported function to a variable,
an interface to a type alias, or a re-export to a class could previously be reported as an export
deletion even though the same file still exported that name. The rule now checks whether an
exported name remains in the file, and local regression tests cover both JavaScript and TypeScript.
That does **not** establish behavioral or type compatibility of the replacement.

The p-queue `throwOnTimeout` removal is deliberately a no-deletion case in this focused
export-removal evaluation. It is assessed separately below by the new type-member rule. Changing
the implementation behind an unchanged exported name can also break callers. These are not clean
bills of health: the sample is hand-selected and non-random, so the counts above are agreement on
these cases rather than a general precision or recall estimate.

## Public type-member spot-check

The `api/public-type-member-removed` rule was run against p-queue commit
`e48716fa1236fdd8ac0ad88f7831467f2455976a` and its first parent, without installing or
executing p-queue. It reports two `high` findings in `source/options.ts`: the removed
`throwOnTimeout` member of exported `Options` and `QueueAddOptions`. Both public aliases include
the same changed private `TimeoutOptions` type through local intersections. The integration suite
also includes a smaller Git-snapshot regression for this shape and a negative case where a member
is moved between local type components.

```bash
node dist/presentation/cli/main.js analyze \
  --cwd ../p-queue \
  --base 'e48716fa1236fdd8ac0ad88f7831467f2455976a^' \
  --head e48716fa1236fdd8ac0ad88f7831467f2455976a \
  --json
```

This spot-check establishes detection for that fixed commit, not general recall. Unions,
cross-file type references, generic alias instantiation, and full TypeScript assignability remain
outside the member-removal rule.

## What these results do not prove

- Zero findings is not a correctness verdict. The tool does not execute the external tests or
  prove that an implementation satisfies a PR's request.
- The six changes were selected to cover TypeScript, JavaScript, tests, and documentation; they
  were not randomly sampled. No recall or false-positive rate is inferred.
- JS compatibility analysis records identifiable ESM export removal, not inferred parameter or
  return-type compatibility. CommonJS `module.exports` and nested exports remain outside this
  first JS symbol-analysis slice.
- The import graph contains resolvable string-literal loads at the selected head. Computed loads,
  deleted historical imports, and package-resolution behavior are not resolved.
