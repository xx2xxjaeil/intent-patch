# External repository evaluation

IntentPatch was run against six merged changes from two independent open-source projects. This
checks whether a report can be produced outside this repository and illustrates what the current
static analysis can and cannot establish. Only Git snapshots were read; the external projects'
install, build, and test scripts were not run. Results were measured with this branch's source on
2026-10-18 and are not a precision or recall benchmark.

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
