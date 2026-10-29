# External repository evaluation

The first exploratory run compared six merged changes from two independent open-source projects.
The reviewed-label evaluation below extends that set to 32 distinct changes and 38 rule checks
from three repositories.
Together they show what IntentPatch can and cannot establish outside its own repository. Only Git snapshots were
read; the external projects' install, build, and test scripts were not run. The six-case results
were measured on 2026-10-18; the export-removal evaluation was measured on 2026-10-19 and the
multi-rule extension on 2026-10-21. The signature-compatibility revision was measured on
2026-10-22, the p-limit API extension on 2026-10-26, and the dependency/scope/test extension on
2026-10-30. None is a general precision or recall
benchmark.

## Reproduce

Use full clones (or fetch the listed commits and their parents) and build IntentPatch itself:

```bash
npm ci
npm run build
git clone https://github.com/sindresorhus/p-queue.git ../p-queue
git clone https://github.com/ai/nanoid.git ../nanoid
git clone https://github.com/sindresorhus/p-limit.git ../p-limit
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

## Curated multi-rule evaluation

A versioned [case manifest](./external-evaluation-cases.json) contains 38 independently reviewed
rule checks over 32 distinct changes from p-queue, nanoid, and p-limit, including the six
exploratory changes above.
Each case names **one rule** and its expected `(file, exported name)`, `(file, package)`, or
`(file)` labels, reviewed against the
Git diff before running the evaluator. A commit is scored for another rule only when it has a
separate reviewed case; an unchecked rule is neither a pass nor a failure. Sixteen checks cover
`api/exported-symbol-removed`; the other 21 checks cover three more public-API rules and
dependency, scope, and test-change rules. Scope and test cases carry explicit Change Contracts;
the evaluator writes them only to a temporary file, not into an external checkout.

With full clones in a common parent directory, reproduce the evaluation without installing or
running any external project's dependencies or scripts:

```bash
git clone https://github.com/ai/nanoid.git ../nanoid
git clone https://github.com/sindresorhus/p-queue.git ../p-queue
git clone https://github.com/sindresorhus/p-limit.git ../p-limit
npm ci
npm run evaluate:external -- --repositories ..
```

The script checks every fixed commit and its parent, builds IntentPatch, runs the CLI against the
Git snapshots once per unique change, and compares only the selected rule's findings with its
reviewed labels. `--json` includes per-case, per-rule, and overall counts. A mismatch exits
nonzero. On 2026-10-30, all 38 checks matched. Twelve cases expect findings and 26 expect none
for their selected rule:

| Rule | Checks | Matched expected labels | Missing | Unexpected |
| --- | ---: | ---: | ---: | ---: |
| `api/exported-symbol-removed` | 16 | 10 | 0 | 0 |
| `api/public-type-member-removed` | 5 | 2 | 0 | 0 |
| `api/public-signature-changed` | 6 | 5 | 0 | 0 |
| `api/public-interface-changed` | 2 | 1 | 0 | 0 |
| `dependency/new-production` | 2 | 1 | 0 | 0 |
| `dependency/removed` | 2 | 2 | 0 | 0 |
| `dependency/version-changed` | 1 | 4 | 0 | 0 |
| `scope/outside-expected-path` | 2 | 1 | 0 | 0 |
| `tests/missing-related-change` | 2 | 1 | 0 | 0 |
| **Total** | **38** | **27** | **0** | **0** |

The new p-limit dependency cases cover adding `yocto-queue`, removing `p-try`, replacing the
`delay` test dependency with native timers, updating four declared ranges, and a version-only release that must not look like a
new dependency. The declared-scope pair checks one unexpected manifest change and one fully
covered source/test change. The related-test pair uses an explicit `index.js` → `test.js` mapping:
one change includes the test and another does not. The contract expresses a reviewer-chosen
boundary, not a boundary inferred from the commit message.

The six p-limit cases cover adding a public export, widening the default function's argument to
`number | Options`, narrowing `limitFunction` to PromiseLike callbacks, adding the map callback's
index, accepting iterable map inputs, and adding an optional `rejectOnClear` setting. The
`number | Options` change initially produced a false warning: the isolated TypeScript checker
could not resolve the unchanged `LimitFunction` return name or the new `Options` name. IntentPatch
now has a deliberately narrow syntactic proof when every previous primitive parameter remains
accepted by its corresponding parameter and the return text stays unchanged. The narrowing case still
produces a warning. This proof does not resolve whether an unchanged alias name has changed its
underlying definition; no general alias-aware compatibility claim is made.

These are finding-label agreements, not proven compatibility judgments. An empty expected set
means the reviewed diff does not warrant a finding **for that one rule**, not that the change is
safe overall.

This evaluation exposed a concrete false positive: changing an exported function to a variable,
an interface to a type alias, or a re-export to a class could previously be reported as an export
deletion even though the same file still exported that name. The rule now checks whether an
exported name remains in the file, and local regression tests cover both JavaScript and TypeScript.
That does **not** establish behavioral or type compatibility of the replacement.

The p-queue `throwOnTimeout` removal is deliberately a no-deletion case for the export-removal
rule, but a positive case for the public type-member rule. Changing the implementation behind an
unchanged exported name can also break callers. The sample is hand-selected and non-random, so
the counts above must not be read as general precision or recall estimates.

## Reviewed public-contract examples

The [p-queue `throwOnTimeout` removal](https://github.com/sindresorhus/p-queue/commit/e48716fa1236fdd8ac0ad88f7831467f2455976a)
produces two `high` type-member findings in `source/options.ts`: exported `Options` and
`QueueAddOptions` both include the changed private `TimeoutOptions` through local intersections.
The [addition of `carryoverIntervalCount`](https://github.com/sindresorhus/p-queue/commit/a6096de0fe60ab142c7db3a416416cfebad44601)
is a negative control: its deprecated predecessor remains. The integration suite also covers a
member moved between local type components without removal.

The [Nano ID `customAlphabet` API change](https://github.com/ai/nanoid/commit/38f188832d01e02e6c02f21ad357b607a1b59533)
changes three exported declaration-file signatures: secure, async, and non-secure entry points.
Their required size parameter becomes optional and the returned function accepts an optional size;
the strict TypeScript assignability check confirms that the old callable types remain accepted, so
these are now negative cases. The
[generic return-type change](https://github.com/ai/nanoid/commit/ea64dc7cfb7b12ac244fefe0dfa1f61570a8669e)
is another compatible case. In contrast, the
[Nano ID argument reorder](https://github.com/ai/nanoid/commit/b488b4823a8b527d7fa71d94a502278e0649bbc2)
keeps four signature warnings because the new callable types no longer accept the old call shapes.
The [implementation-only size fix](https://github.com/ai/nanoid/commit/0b2cec58ffd5ddc45978bf75a3bab46f53c76128)
is a separate negative control. The
[p-queue `Queue` interface change](https://github.com/sindresorhus/p-queue/commit/a9f57787d80bfff93df621058d34be6212a91fd2)
changes type parameters and member contracts; adding an unrelated exported type is its negative
control. These labels record changed public contracts, not whether every consumer would break.

```bash
node dist/presentation/cli/main.js analyze \
  --cwd ../p-queue \
  --base 'e48716fa1236fdd8ac0ad88f7831467f2455976a^' \
  --head e48716fa1236fdd8ac0ad88f7831467f2455976a \
  --json
```

These checks establish detection for fixed commits, not general recall. Unions,
cross-file type references, generic alias instantiation, and full TypeScript assignability remain
outside the member-removal rule.

## What these results do not prove

- Zero findings is not a correctness verdict. The tool does not execute the external tests or
  prove that an implementation satisfies a PR's request.
- The changes were hand-selected to exercise TypeScript, JavaScript, tests, and documentation;
  they were not randomly sampled. No recall or false-positive rate is inferred.
- The signature rule suppresses a textual change when a strict TypeScript assignment check on
  self-contained callable types succeeds, or when the narrow primitive-parameter widening proof
  applies. Other unresolved external/local types, inferred types, and unsupported signature
  shapes retain the review warning. This does not prove runtime behavior or whole-project
  compatibility.
- JS compatibility analysis records identifiable ESM export removal, not inferred parameter or
  return-type compatibility. CommonJS `module.exports` and nested exports remain outside this
  first JS symbol-analysis slice.
- The import graph contains resolvable string-literal loads at the selected head. Computed loads,
  deleted historical imports, and package-resolution behavior are not resolved.
