# IntentPatch

**English** | [한국어](./README.ko.md)

[![CI](https://github.com/xx2xxjaeil/intent-patch/actions/workflows/ci.yml/badge.svg)](https://github.com/xx2xxjaeil/intent-patch/actions/workflows/ci.yml)

> Evidence-based change-scope analysis for code written by AI coding agents

AI coding agents such as Codex, Claude Code, and Cursor can change many files from a short request. As the patch grows, it becomes harder to answer a few important questions:

- Did the agent change files outside the requested scope?
- Did it recreate logic that already existed?
- Did it add an unnecessary dependency or abstraction?
- How far can the change affect other modules?
- Were relevant tests changed with the production code?

IntentPatch combines **Git diff analysis, static analysis, and dependency analysis** to answer those questions. Its core analysis is deterministic and works without an LLM. Optional AI explanations can be added later without making the core tool dependent on a model provider.

## Quick start

IntentPatch requires Node.js 20 or later and Git. Until the first public npm release is approved, build and run it directly from the repository:

```bash
git clone https://github.com/xx2xxjaeil/intent-patch.git
cd intent-patch
npm ci
npm run build
node dist/presentation/cli/main.js --version
node dist/presentation/cli/main.js analyze --cwd /path/to/repository
```

After the npm release becomes public, run the same CLI without installing it globally:

```bash
npx intentpatch analyze --cwd /path/to/repository
npx intentpatch analyze --format html --output intentpatch-report.html
```

The core analyzer needs no API key, paid AI model, server, or database. Repository files are processed locally, and no LLM is used in the default execution path.

## GitHub Action

Use IntentPatch in pull requests to check scope and risky changes automatically. The checkout must include the full Git history so the action can compare the exact base and head commits.

```yaml
name: IntentPatch

on:
  pull_request:

permissions:
  contents: read

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Analyze pull request
        id: intentpatch
        uses: xx2xxjaeil/intent-patch@main
        with:
          fail-on: high

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: intentpatch-report
          path: intentpatch-report
```

The development version currently runs from `@main`. After the first stable release, pin the action to an immutable commit SHA or a major tag such as `@v1`.

The action detects the comparison range for pull request and push events and produces:

- a Markdown report in the GitHub Actions Job Summary;
- workflow annotations grouped by severity;
- JSON and HTML reports that can be uploaded as artifacts;
- a quality gate at the `high`, `medium`, or `low` threshold;
- action outputs containing finding counts and report paths.

See the [GitHub Action guide](./docs/github-action.md) for inputs, outputs, and event-specific comparison behavior.

## What the report looks like

```text
IntentPatch Change Report

Target               HEAD → working tree
Files changed        12
Lines                +438 / -51
Direct dependents    2
Transitive impact    4
Tests changed        3
Missing test changes 1
New dependencies     2
Risky API changes    1
Duplicate candidates 1
Single implementations 1

Impacted files

→  direct              src/api/delete-user.ts
   changed: src/lib/auth.ts
→  transitive · 2 hops src/app.ts
   changed: src/lib/auth.ts

Potential issues

HIGH    Breaking change to a public function signature
MEDIUM  Implementation duplicates existing authentication logic
MEDIUM  Four files changed outside the expected scope
LOW     New abstraction has only one implementation
```

Every finding includes the relevant file, a stable rule ID, and evidence for the decision instead of only presenting an unexplained warning.

## Implemented capabilities

The current version analyzes Git changes, direct dependencies in the root `package.json`, top-level TypeScript symbols and public API changes, possible duplicate implementations, single-implementation abstractions, import-graph impact, and related test changes.

### Git and reporting

- Compare `HEAD` with the current working tree.
- Compare two Git references or branches from their merge base.
- Classify added, modified, deleted, and renamed files.
- Count added and deleted lines per file.
- Distinguish binary files.
- Include untracked files in working-tree analysis.
- Render terminal-friendly text and machine-readable JSON reports.
- Generate a standalone HTML report containing summary cards, findings, test signals, and an impact graph.
- Render the visualization with inline CSS and SVG, without a CDN or runtime JavaScript dependency.
- Aggregate findings by `high`, `medium`, and `low` severity.
- Return a CI-friendly exit code through `--fail-on`.
- Print the installed package version through `--version`.

### Dependencies and TypeScript structure

- Detect additions to production and development dependencies.
- Detect dependency removal, version changes, and section moves.
- Report malformed `package.json` files as evidence-backed findings instead of crashing.
- Extract top-level named functions, classes, interfaces, and type aliases from `.ts` and `.tsx` files.
- Detect symbol additions, modifications, and removals with source locations.
- Preserve direct exports, local export lists, and external re-exports as public-symbol evidence.
- Report removed public symbols and removed exports as high-severity compatibility risks.
- Detect removed public function call signatures and incompatible public interface changes.
- Exclude overloads that only gain an implementation while reporting previously available overloads that disappear.
- Find newly added functions whose normalized implementation matches an existing function.
- Report a newly added interface when exactly one class explicitly implements it.
- Compare symbols correctly across renamed files.
- Preserve syntax errors as analysis evidence instead of silently dropping a file.

### Impact, scope, and tests

- Build relative static import and re-export relationships for `.ts` and `.tsx` files.
- Resolve `.js`, `.jsx`, `.mjs`, and `.cjs` import specifiers to matching TypeScript sources.
- Calculate direct importers and transitively impacted files for changed modules.
- Preserve unresolved relative imports and file read or parse failures as evidence.
- Build the graph at the same result point as the diff: the working tree or the selected head ref.
- Read intent, expected paths, allowed paths, and change budgets from `.intentpatch.json`.
- Report each file outside expected and allowed patterns as a medium-severity finding.
- Report file-count and measurable-line budget overruns with numeric evidence.
- Classify source and test paths declared by the contract and connect related changes by basename.
- Report test file counts and added or deleted tests as separate facts.
- Report source files without a related test change as medium-severity findings.
- Support repository-relative `*`, `**`, and `?` path patterns.

Lockfile transitive dependency analysis, path aliases, JavaScript and method-level structure analysis, and optional AI review are not implemented yet.

## CLI usage

Analyze the current repository's working tree:

```bash
node dist/presentation/cli/main.js analyze
```

Analyze another Git repository:

```bash
node dist/presentation/cli/main.js analyze --cwd /path/to/repository
```

Compare two branches. IntentPatch analyzes their changes from the merge base:

```bash
node dist/presentation/cli/main.js analyze \
  --cwd /path/to/repository \
  --base main \
  --head feature/account-deletion
```

Write JSON output:

```bash
node dist/presentation/cli/main.js analyze --json
```

Create a standalone HTML report:

```bash
node dist/presentation/cli/main.js analyze \
  --format html \
  --output intentpatch-report.html
```

The HTML file contains all styles and the dependency-impact SVG, so it opens directly without a server or API key. `--output` also works with text and JSON formats. Relative output paths are resolved from the directory where IntentPatch is executed. `--json` is an alias for `--format json`.

### Check request scope with a Change Contract

Create `.intentpatch.json` in the repository being analyzed and declare the expected scope of the request:

```json
{
  "intent": "Implement account deletion",
  "scope": {
    "include": ["src/user/**", "tests/user/**"],
    "allow": ["package.json", "package-lock.json"],
    "maxFiles": 8,
    "maxLines": 300
  },
  "tests": {
    "requireFor": ["src/**/*.ts", "src/**/*.tsx"],
    "include": ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    "exclude": ["src/**/*.d.ts"]
  }
}
```

- `include`: paths expected to change for the request;
- `allow`: exceptional paths such as configuration or lockfiles;
- `maxFiles`: maximum number of changed files;
- `maxLines`: maximum total of measurable added and deleted lines;
- `tests.requireFor`: source paths that require a related test change;
- `tests.include`: paths classified as tests;
- `tests.exclude`: generated or declaration files excluded from the source check.

Test matching uses basenames for deterministic results. For example, `src/user.ts` can match changed files such as `tests/user.test.ts`, `user.spec.ts`, or `user.integration.test.ts`.

Use `--config` to select another contract. Relative paths are resolved from `--cwd`:

```bash
node dist/presentation/cli/main.js analyze \
  --cwd /path/to/repository \
  --config contracts/delete-user.json
```

Start with [`.intentpatch.example.json`](./.intentpatch.example.json). Without a contract, all existing analysis still runs and only the scope rules are disabled.

### Quality gates

Return exit code `1` after rendering the report when a finding meets or exceeds the selected severity:

```bash
node dist/presentation/cli/main.js analyze --fail-on medium
```

`medium` reacts to both medium- and high-severity findings. `low` treats every finding as a quality-gate failure. Invalid CLI usage returns exit code `2`.

An evidence-rich result looks like this:

```text
IntentPatch Change Report

Files changed        2
Changed symbols      2
Import edges         18
Direct dependents    1
Transitive impact    2
Tests changed        1
Tests added          0
Missing test changes 1
New dependencies     1
Risky API changes    1
Duplicate candidates 1
Single implementations 1
Findings             6

Changed symbols

M  Class         UserService                  src/user/service.ts:12
A  Function      deleteUser                   src/user/service.ts:48

Impacted files

→  direct              src/api/delete-user.ts
   changed: src/user/service.ts
→  transitive · 2 hops src/app.ts
   changed: src/user/service.ts

Potential issues

HIGH    Public export removed
        src/user/service.ts · api/export-removed
        The function deleteUser is no longer exported.

MEDIUM  New production dependency
        package.json · dependency/new-production
        dayjs@^1.11.0 was added to dependencies.

MEDIUM  Change outside expected scope
        src/payment/billing.ts · scope/outside-expected-path
        src/payment/billing.ts does not match any expected or allowed path pattern.

MEDIUM  Source change without matching test change
        src/payment/billing.ts · tests/missing-related-change
        src/payment/billing.ts changed without a changed test sharing the same basename.

MEDIUM  New function duplicates existing implementation
        src/user/service.ts · structure/duplicate-implementation
        The new function verifySession has the same normalized implementation as authorize.

LOW     New interface has one implementation
        src/user/service.ts · structure/single-implementation-abstraction
        The new interface DeletionStrategy is implemented only by DefaultDeletionStrategy.
```

Run the TypeScript entry point directly during development:

```bash
npm run dev -- analyze --cwd /path/to/repository
```

## Architecture

IntentPatch applies Clean Architecture dependency direction so Git, presentation, and analysis rules do not become tightly coupled as the project grows.

```text
presentation ───────▶ application ───────▶ domain
      │                     ▲
      └──▶ infrastructure ──┘
```

| Layer | Responsibility |
| --- | --- |
| `domain` | Core models for changed files, Change Contracts, findings, symbol changes, and dependency impact |
| `application` | Analysis use cases, rule engine, symbol and impact calculations, and ports for external data |
| `infrastructure` | Git commands, diff parsing, project-file access, and TypeScript AST parsing |
| `presentation` | CLI argument handling, dependency composition, and text, JSON, and HTML output |

Architecture tests enforce the import direction so inner layers never depend on external implementations. See the [architecture document](./docs/architecture.md) for design decisions and extension points.

## Design principles

- **Deterministic first:** the same input produces the same core analysis result.
- **Evidence over claims:** uncertain signals are not presented as facts.
- **LLM optional:** useful analysis remains available without an AI provider.
- **Dependency minimalism:** convenience alone does not justify another library.
- **Explicit boundaries:** domain logic stays separate from external details such as Git and CLI frameworks.

## Testing and quality checks

```bash
npm run check
```

This command runs:

- strict TypeScript type checking;
- Biome lint and format checks;
- domain and use-case unit tests;
- integration tests against real temporary Git repositories;
- a package integration test that installs the generated npm tarball in a temporary project and executes it;
- architecture tests that enforce dependency direction;
- a reproducibility check for the bundled GitHub Action.

Run only the production build with:

```bash
npm run build
```

Inspect the files that would be published without creating a public release:

```bash
npm pack --dry-run
```

## Release process

Pushing a tag such as `v0.1.0`, matching the version in `package.json`, from a commit contained in the default branch triggers the release workflow:

1. Validate the tag, package version, and default-branch ancestry.
2. Run the full quality suite and inspect the npm package with a dry run.
3. Publish through npm Trusted Publishing with OpenID Connect.
4. Create a GitHub Release with automatically generated notes.

No long-lived npm token is stored as a GitHub secret. Public packages published through OIDC receive npm provenance automatically. A package that does not yet exist on npm needs a one-time bootstrap before a Trusted Publisher can be configured. See the [release operations guide](./docs/releasing.md) for bootstrap and subsequent release procedures.

## Roadmap

1. ✅ Direct `package.json` dependency detection and rule engine
2. ✅ TypeScript AST analysis for functions, classes, interfaces, and types
3. ✅ Relative static import graph and change-impact calculation
4. ✅ Change Contract scope and change-budget analysis
5. ✅ Contract-based detection of missing related test changes
6. Package-manager adapters for lockfiles and workspaces
7. ✅ Detection of removed public exports
8. ✅ Standalone HTML dashboard and SVG dependency-impact graph
9. ✅ Re-export and function/interface compatibility checks plus possible code duplication
10. ✅ Detection of newly introduced single-implementation interfaces
11. ✅ GitHub Action with PR/push comparison, Job Summary, annotations, and artifacts
12. Codex, Claude Code, and Cursor adapters
13. Optional LLM explanations grounded in deterministic evidence

## Current limitations

- The target must be a Git repository with at least one commit.
- Untracked symbolic links are not read for safety.
- Line counts are skipped for untracked files larger than 10 MiB.
- Dependency analysis covers only `dependencies` and `devDependencies` in the root npm `package.json`.
- Transitive lockfile dependencies, workspace packages, and real dependency usage in source code are not analyzed yet.
- Symbol analysis supports named top-level functions, classes, interfaces, and type aliases in `.ts` and `.tsx` files.
- Public API analysis supports named top-level functions and interfaces, local `export { name }`, external `export { name } from`, and `export * from`. Package `exports`, anonymous default exports, and detailed class or type-alias contracts are not interpreted yet.
- Function compatibility compares explicitly written parameter and return-type text. It does not evaluate inferred return types or full TypeScript structural assignability.
- Duplicate candidates require a newly added top-level function and an existing top-level function to have exactly the same normalized tokens after comments and whitespace are removed, with at least 12 body tokens. Renamed identifiers, methods, and semantically equivalent implementations are not detected.
- A single-implementation abstraction is reported only when exactly one named class explicitly uses `implements` for a new interface. Structural implementation, factory return types, and runtime registration are not calculated.
- Methods, variable declarations, enums, nested declarations, and JavaScript files are not included in symbol analysis.
- Formatting or comment changes inside a declaration can be counted as symbol modifications.
- Impact analysis covers relative static `import`, side-effect imports, `export ... from`, and `import = require()` in `.ts` and `.tsx` files.
- External package imports, path aliases, dynamic `import()`, and ordinary `require()` are not included in the graph.
- The graph is built from files at the comparison result point: the working tree or head ref. Impact from historical imports that referenced a deleted module cannot be calculated yet.
- Source files used for impact analysis are limited to 1 MiB per file, and symbolic links are not read.
- IntentPatch does not infer expected paths from natural-language intent. Scope decisions use the contract's explicit `include` and `allow` patterns.
- Path patterns support only repository-relative `*`, `**`, and `?`; negation and brace expansion are not supported.
- `maxLines` sums only measurable added and deleted lines in text files. Binary or unmeasurable files are not treated as zero lines, but their size is not included in the budget.
- Test analysis compares only the changed paths declared in the contract; it does not execute tests or measure coverage.
- Related tests are matched by basename. Integration tests with different names or one test covering several source files cannot be linked automatically yet.
- The HTML impact graph uses a deterministic two-column layout. Interactive node movement, zooming, and filtering are not implemented yet.

## License

[MIT](./LICENSE)
