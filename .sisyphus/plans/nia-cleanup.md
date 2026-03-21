# Nia Plugin Cleanup — Dead Code, DRY Consolidation, Hygiene

## TL;DR

> **Quick Summary**: Remove 3 dead utility modules (+ their tests), consolidate duplicated result formatting and truncation logic, fix stale config exports, sync CLI version, align Dockerfile, and add test script separation + linter config.
> 
> **Deliverables**:
> - 6 dead files deleted (3 source + 3 test)
> - NormalizedResult/formatResults extracted to shared module
> - truncateMarkdown consolidated to single implementation
> - Stale NIA_API_KEY/NIA_MCP_URL exports removed from config.ts
> - CLI version synced from package.json
> - Dockerfile bun version aligned
> - test:unit / test:integration scripts added
> - Biome linter configured
> 
> **Estimated Effort**: Quick-to-Short (~2-3 hours)
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 → Task 3 → Task 4 → Task 8 → F1-F4

---

## Context

### Original Request
Follow-up polish round after a major 31-task improvement cycle. User asked "is there anything else to improve?" — audit revealed dead code, DRY violations, and hygiene gaps.

### Interview Summary
**Key Discussions**:
- Breaking changes OK (v0.1.x, no downstream consumers)
- TDD approach: failing tests first, then implementation
- Previous constraints preserved (don't touch session.ts LRU, smart-triggers Set, ops-tracker cleanup)

**Research Findings**:
- `validate.ts`, `permission.ts`, `sse-parser.ts` have zero production imports (confirmed via grep)
- `NIA_API_KEY`/`NIA_MCP_URL` in config.ts are stale module-level reads, never imported
- `formatResults` and `NormalizedResult` are near-identical in nia-search.ts and nia-research.ts
- `truncateMarkdown` differs: nia-search.ts uses `"\n\n[truncated]"`, format.ts uses `"[truncated]"` — NOT identical
- `source-resolver.ts` IS used (by nia-read, nia-grep, nia-explore) — NOT dead code
- `resolveJsonModule: true` already in tsconfig.json — JSON imports work with tsc
- `isAbortError`/`isZodError` imported but never used directly in nia-research.ts body

### Metis Review
**Identified Gaps** (addressed):
- truncateMarkdown behavior difference (resolved: adopt search variant with `\n\n` prefix for markdown readability)
- 6 file deletions needed, not 3 (dead test files must also go)
- isAbortError/isZodError must be verified unused in function body before removing
- Linter scope locked to config-only, zero auto-fixes
- Test utility duplication (createContext/TEST_CONFIG) explicitly excluded from scope
- Dockerfile target version decision (resolved: match bun-types 1.3.11)
- Test script separation glob pattern decision (resolved: `src/**/*.test.ts` for unit, `tests/integration/**` for integration)

---

## Work Objectives

### Core Objective
Remove dead code, consolidate remaining DRY violations, and add missing developer tooling (linter, test script separation) to complete the project's polish cycle.

### Concrete Deliverables
- 6 files deleted: `src/utils/{validate,permission,sse-parser}.{ts,test.ts}`
- Shared result formatting in `src/utils/format.ts` (NormalizedResult type + formatResults + truncateMarkdown consolidated)
- Clean config.ts without stale singleton exports
- Dynamic CLI version from package.json
- Dockerfile with bun 1.3.11
- `test:unit` and `test:integration` package.json scripts
- `biome.json` linter configuration

### Definition of Done
- [ ] `bun test` — all unit tests pass (count should be ~280 after dead test removal, remaining green)
- [ ] `bun run typecheck` — zero tsc errors
- [ ] `bun run build` — dist/ builds successfully
- [ ] `bun run lint` — exits 0 on current codebase
- [ ] `grep -r "type NormalizedResult" src/ | wc -l` returns `1`
- [ ] `grep -rn "function truncateMarkdown" src/ | wc -l` returns `1`
- [ ] `grep -n "export const NIA_API_KEY\|export const NIA_MCP_URL" src/config.ts | wc -l` returns `0`
- [ ] Total line delta is negative (cleanup removes more than it adds)

### Must Have
- All dead files removed (source + test)
- DRY consolidation for NormalizedResult/formatResults/truncateMarkdown
- Stale config exports removed
- CLI version synced from package.json
- Test script separation
- Linter configuration that passes on current code

### Must NOT Have (Guardrails)
- Do NOT consolidate `createContext()` or `TEST_CONFIG` across test files (14+ files — separate effort)
- Do NOT consolidate config guard patterns (`if (!config.apiKey)`) across tool files (intentional per-tool isolation)
- Do NOT refactor `ABORT_ERROR` strings across tool files (each tool's unique identifier is intentional)
- Do NOT apply linter auto-fixes to existing code (config-only, zero fixes applied)
- Do NOT add CI/CD, `.env.example`, or migrate `cli.test.ts` from vitest
- Do NOT change the plugin lazy-loading pattern in `index.ts`
- Do NOT touch `session.ts` LRU eviction, `smart-triggers.ts` triggeredTypes Set, or `ops-tracker.ts` cleanup logic
- Do NOT add new CLI commands or flags
- Do NOT change existing import paths for non-dead modules beyond what's needed
- Do NOT remove vitest from devDependencies (cli.test.ts still uses it)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: TDD (failing tests first for new shared modules, then implementation)
- **Framework**: bun test (existing)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Module changes**: Use Bash (`bun test`, `bun run typecheck`, `bun run build`)
- **File deletions**: Use Bash (`test ! -f <path>`) to verify files are gone
- **CLI**: Use Bash (`bun run dist/cli.js --version`) to verify version sync
- **Docker**: Use Bash (`docker build -t test .`) to verify Dockerfile

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — independent deletions + removals):
├── Task 1: Delete 3 dead utility files + 3 dead test files [quick]
├── Task 2: Remove unused imports from nia-research.ts [quick]
├── Task 5: Remove stale NIA_API_KEY/NIA_MCP_URL exports from config.ts [quick]
├── Task 6: Sync CLI version from package.json [quick]
├── Task 7: Align Dockerfile bun version [quick]
└── Task 8: Add test:unit / test:integration scripts [quick]

Wave 2 (After Task 1 — DRY consolidation depends on dead code removal):
├── Task 3: Extract NormalizedResult + formatResults to shared module [unspecified-high]
├── Task 4: Consolidate truncateMarkdown to single implementation [quick]
└── Task 9: Add Biome linter configuration [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 3, 4 |
| 2 | — | — |
| 3 | 1 | F1-F4 |
| 4 | 1 | F1-F4 |
| 5 | — | — |
| 6 | — | — |
| 7 | — | — |
| 8 | — | — |
| 9 | — | F1-F4 |
| F1-F4 | ALL | user okay |

### Agent Dispatch Summary

- **Wave 1**: **6 tasks** — T1 → `quick`, T2 → `quick`, T5 → `quick`, T6 → `quick`, T7 → `quick`, T8 → `quick`
- **Wave 2**: **3 tasks** — T3 → `unspecified-high`, T4 → `quick`, T9 → `quick`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. Delete 3 dead utility files + 3 dead test files

  **What to do**:
  - Delete `src/utils/validate.ts` and `src/utils/validate.test.ts`
  - Delete `src/utils/permission.ts` and `src/utils/permission.test.ts`
  - Delete `src/utils/sse-parser.ts` and `src/utils/sse-parser.test.ts`
  - Run `bun test` to verify no production code depended on these
  - Run `bun run typecheck` to verify no type references are broken

  **Must NOT do**:
  - Do NOT delete `source-resolver.ts` (it IS used by nia-read, nia-grep, nia-explore)
  - Do NOT delete any test fixtures in `tests/fixtures/`
  - Do NOT modify any other files in this task

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 6 file deletions + verification commands, no logic changes
  - **Skills**: []
    - No specialized skills needed for file deletion
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not needed — deletion is straightforward

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 5, 6, 7, 8)
  - **Blocks**: Tasks 3, 4 (DRY consolidation depends on dead code being gone to avoid merge conflicts)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/utils/validate.ts` — Target for deletion. Zero production imports confirmed via grep.
  - `src/utils/permission.ts` — Target for deletion. Zero production imports confirmed via grep.
  - `src/utils/sse-parser.ts` — Target for deletion. Zero production imports — client.ts has its own inline SSE parsing.

  **WHY Each Reference Matters**:
  - These files exist only to be imported by their own co-located test files. No production code references them.
  - Verified via: `grep -r "from.*utils/validate" src/` → only validate.test.ts; same for permission and sse-parser.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All 6 dead files are removed
    Tool: Bash
    Preconditions: Files currently exist in src/utils/
    Steps:
      1. Run: rm src/utils/validate.ts src/utils/validate.test.ts src/utils/permission.ts src/utils/permission.test.ts src/utils/sse-parser.ts src/utils/sse-parser.test.ts
      2. Run: test ! -f src/utils/validate.ts && test ! -f src/utils/validate.test.ts && test ! -f src/utils/permission.ts && test ! -f src/utils/permission.test.ts && test ! -f src/utils/sse-parser.ts && test ! -f src/utils/sse-parser.test.ts
      3. Run: bun test
      4. Run: bun run typecheck
    Expected Result: All 6 files gone; bun test passes (fewer tests than before, but zero failures); typecheck clean
    Failure Indicators: `bun test` or `bun run typecheck` exits non-zero; any "module not found" errors
    Evidence: .sisyphus/evidence/task-1-dead-files-removed.txt

  Scenario: No production code was broken by deletion
    Tool: Bash
    Preconditions: 6 files deleted
    Steps:
      1. Run: bun run build
      2. Run: ls dist/utils/ | grep -c "validate\|permission\|sse-parser" (should be 0)
    Expected Result: Build succeeds; no dead files in dist/
    Failure Indicators: Build fails; dist/ contains deleted modules
    Evidence: .sisyphus/evidence/task-1-build-clean.txt
  ```

  **Commit**: YES (commit 1)
  - Message: `chore: remove dead utility files (validate, permission, sse-parser)`
  - Files: 6 deletions
  - Pre-commit: `bun test && bun run typecheck`

- [ ] 2. Remove unused imports from nia-research.ts

  **What to do**:
  - Open `src/tools/nia-research.ts`
  - Verify `isAbortError` and `isZodError` are NOT used in the function body (only imported)
  - Remove the unused imports from the import statement on lines 15-16
  - Keep `createToolErrorFormatter`, `inlineCode`, `stringOrFallback` (these ARE used)
  - Run typecheck to verify

  **Must NOT do**:
  - Do NOT remove imports that ARE used (createToolErrorFormatter, inlineCode, stringOrFallback)
  - Do NOT modify the function logic
  - Do NOT touch any other tool files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single import line edit in one file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 5, 6, 7, 8)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/tools/nia-research.ts:14-18` — Import block. Lines 15-16 import `isAbortError` and `isZodError` which are never called in the function body. The `createToolErrorFormatter` on line 20 calls `formatUnexpectedError` which handles them internally.

  **WHY Each Reference Matters**:
  - `isAbortError` and `isZodError` are used inside `formatUnexpectedError` (called by `createToolErrorFormatter`), NOT directly in nia-research.ts. The imports are dead.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Unused imports removed, typecheck passes
    Tool: Bash
    Preconditions: nia-research.ts currently imports isAbortError and isZodError
    Steps:
      1. Verify isAbortError/isZodError are NOT used in function body: grep -n "isAbortError\|isZodError" src/tools/nia-research.ts (should show only the import line)
      2. Edit import to remove isAbortError and isZodError
      3. Run: bun run typecheck
      4. Run: grep -c "isAbortError\|isZodError" src/tools/nia-research.ts (should be 0)
    Expected Result: Typecheck passes; zero references to removed imports remain
    Failure Indicators: typecheck error mentioning isAbortError/isZodError; grep returns >0
    Evidence: .sisyphus/evidence/task-2-unused-imports.txt
  ```

  **Commit**: YES (commit 2)
  - Message: `refactor: remove unused imports from nia-research`
  - Files: `src/tools/nia-research.ts`
  - Pre-commit: `bun run typecheck`

- [ ] 3. Extract NormalizedResult type + formatResults to shared module

  **What to do**:
  - TDD: Write a test in `src/utils/format.test.ts` for `formatResults()` with known input/output, verify it fails (function doesn't exist in format.ts yet)
  - Add `NormalizedResult` type to `src/utils/format.ts`
  - Move `formatResults()` function to `src/utils/format.ts` (use the implementation from nia-search.ts — they're identical)
  - Export both from `src/utils/format.ts`
  - Update `src/tools/nia-search.ts`: remove local `NormalizedResult` type and `formatResults` function, import from `../utils/format.js`
  - Update `src/tools/nia-research.ts`: remove local `NormalizedResult` type and `formatResults` function, import from `../utils/format.js`
  - Run full test suite to verify output is identical

  **Must NOT do**:
  - Do NOT change the logic of formatResults — copy it exactly
  - Do NOT change normalizeResult / normalizeWebResults / normalizeSearchResults (these stay in their tool files)
  - Do NOT create a new file — add to existing `src/utils/format.ts`
  - Do NOT modify the function signatures

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multi-file refactor with behavioral preservation requirement; needs care to avoid breaking output format
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `typescript-advanced-types`: NormalizedResult is a simple type, no generics needed

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 4, 9 in Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: F1-F4
  - **Blocked By**: Task 1 (dead code removal avoids merge conflicts in utils/)

  **References**:

  **Pattern References**:
  - `src/tools/nia-search.ts:25-33` — `NormalizedResult` type definition (the canonical version to extract)
  - `src/tools/nia-search.ts:227-256` — `formatResults()` function (the canonical version to extract)
  - `src/tools/nia-research.ts:43-51` — Duplicate `NormalizedResult` type (to be replaced with import)
  - `src/tools/nia-research.ts:384-413` — Duplicate `formatResults()` function (to be replaced with import)
  - `src/utils/format.ts` — Target file for the extracted code. Already exports `inlineCode` which `formatResults` uses.

  **WHY Each Reference Matters**:
  - Both tool files define identical `NormalizedResult` and `formatResults`. Extracting to format.ts (which already exports `inlineCode` used by `formatResults`) is the natural home. The tool files then import instead of defining locally.

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Test added to `src/utils/format.test.ts` for `formatResults` with known input
  - [ ] `bun test src/utils/format.test.ts` → PASS after implementation

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: NormalizedResult exists in exactly one place
    Tool: Bash
    Preconditions: Both nia-search.ts and nia-research.ts currently define NormalizedResult
    Steps:
      1. Run: grep -rn "type NormalizedResult" src/ --include="*.ts" | grep -v test | grep -v node_modules
      2. Verify output shows exactly 1 match in src/utils/format.ts
    Expected Result: Exactly 1 definition of NormalizedResult in src/utils/format.ts
    Failure Indicators: More than 1 match; match not in format.ts
    Evidence: .sisyphus/evidence/task-3-normalized-result-single.txt

  Scenario: formatResults exists in exactly one place
    Tool: Bash
    Preconditions: Both tool files currently define formatResults
    Steps:
      1. Run: grep -rn "function formatResults" src/ --include="*.ts" | grep -v test | grep -v node_modules
      2. Verify output shows exactly 1 match in src/utils/format.ts
    Expected Result: Exactly 1 definition of formatResults in src/utils/format.ts
    Failure Indicators: More than 1 match; match not in format.ts
    Evidence: .sisyphus/evidence/task-3-format-results-single.txt

  Scenario: All existing tool tests still pass (output unchanged)
    Tool: Bash
    Preconditions: formatResults extracted to format.ts, tools import it
    Steps:
      1. Run: bun test src/tools/nia-search.test.ts
      2. Run: bun test src/tools/nia-research.test.ts
      3. Run: bun run typecheck
    Expected Result: All tests pass; typecheck clean
    Failure Indicators: Any test failure; typecheck error
    Evidence: .sisyphus/evidence/task-3-tests-pass.txt
  ```

  **Commit**: YES (commit 3)
  - Message: `refactor: extract shared NormalizedResult and formatResults to format.ts`
  - Files: `src/utils/format.ts`, `src/utils/format.test.ts`, `src/tools/nia-search.ts`, `src/tools/nia-research.ts`
  - Pre-commit: `bun test && bun run typecheck`

- [ ] 4. Consolidate truncateMarkdown to single shared implementation

  **What to do**:
  - Update `src/utils/format.ts`: change the `TRUNCATED_MARKER` constant from `"[truncated]"` to `"\n\n[truncated]"` (adopt the nia-search.ts variant for markdown readability)
  - TDD: Add a test to `src/utils/format.test.ts` asserting the new marker includes `\n\n`
  - Remove the local `truncateMarkdown` function and `TRUNCATED_MARKER` constant from `src/tools/nia-search.ts`
  - Update `src/tools/nia-search.ts` to import `truncateMarkdown` from `../utils/format.js`
  - Verify the shared `truncateMarkdown` is already exported from format.ts (it is)
  - Run nia-search tests to verify output preservation

  **Must NOT do**:
  - Do NOT change the truncation logic (slicing + trimEnd) — only the marker constant
  - Do NOT add truncateMarkdown imports to files that don't currently use it

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small constant change + import swap in one file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 3, 9 in Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: F1-F4
  - **Blocked By**: Task 1 (dead code removal avoids merge conflicts in utils/)

  **References**:

  **Pattern References**:
  - `src/utils/format.ts:1` — Current `TRUNCATED_MARKER = "[truncated]"` (needs `\n\n` prefix added)
  - `src/utils/format.ts:63-69` — Current `truncateMarkdown` function (logic stays, marker changes)
  - `src/tools/nia-search.ts:36` — Local `TRUNCATED_MARKER = "\n\n[truncated]"` (the version to adopt)
  - `src/tools/nia-search.ts:258-265` — Local `truncateMarkdown` function (to be deleted, replaced with import)

  **WHY Each Reference Matters**:
  - nia-search.ts has the better marker (`\n\n[truncated]`) for markdown readability. The logic is identical between both files — only the marker differs. Adopting the search variant and removing the local copy achieves DRY without behavior change for the tool that actually uses it.

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Test in `src/utils/format.test.ts` asserts `truncateMarkdown("x".repeat(100), 50)` contains `"\n\n[truncated]"`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: truncateMarkdown exists in exactly one place
    Tool: Bash
    Preconditions: nia-search.ts currently has its own copy
    Steps:
      1. Run: grep -rn "function truncateMarkdown" src/ --include="*.ts" | grep -v test | grep -v node_modules
      2. Verify exactly 1 match in src/utils/format.ts
    Expected Result: Single implementation in format.ts
    Failure Indicators: More than 1 match; match not in format.ts
    Evidence: .sisyphus/evidence/task-4-truncate-single.txt

  Scenario: nia-search tests still pass with shared implementation
    Tool: Bash
    Preconditions: nia-search.ts now imports truncateMarkdown from format.ts
    Steps:
      1. Run: bun test src/tools/nia-search.test.ts
      2. Run: bun run typecheck
    Expected Result: All search tool tests pass; typecheck clean
    Failure Indicators: Any test failure referencing truncation
    Evidence: .sisyphus/evidence/task-4-search-tests.txt
  ```

  **Commit**: YES (commit 4)
  - Message: `refactor: consolidate truncateMarkdown to single shared implementation`
  - Files: `src/utils/format.ts`, `src/utils/format.test.ts`, `src/tools/nia-search.ts`
  - Pre-commit: `bun test && bun run typecheck`

- [ ] 5. Remove stale NIA_API_KEY/NIA_MCP_URL singleton exports from config.ts

  **What to do**:
  - Delete lines 223-224 from `src/config.ts`:
    ```ts
    export const NIA_API_KEY = process.env.NIA_API_KEY;
    export const NIA_MCP_URL = process.env.NIA_API_URL ?? DEFAULTS.apiUrl;
    ```
  - Run typecheck to verify nothing imports them
  - These are stale module-level reads that freeze at import time. `loadConfig()` handles env var reading correctly.

  **Must NOT do**:
  - Do NOT change `loadConfig()` or `isConfigured()` — they work correctly
  - Do NOT change how `process.env.NIA_API_KEY` is read inside `loadConfig()`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 2-line deletion
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 6, 7, 8)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/config.ts:223-224` — The two stale singleton exports to delete
  - `src/config.ts:158-217` — `loadConfig()` function (correctly reads env vars per-call — this is the RIGHT pattern)

  **WHY Each Reference Matters**:
  - Lines 223-224 read `process.env` at module load time, creating stale values. `loadConfig()` on line 158 reads env vars fresh each call. The exports are never imported by any production code (confirmed via grep), but they're a trap for anyone who might import them in the future.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Stale exports removed, typecheck passes
    Tool: Bash
    Preconditions: config.ts exports NIA_API_KEY and NIA_MCP_URL on lines 223-224
    Steps:
      1. Delete the two export lines
      2. Run: grep -n "export const NIA_API_KEY\|export const NIA_MCP_URL" src/config.ts | wc -l
      3. Run: bun run typecheck
    Expected Result: grep returns 0; typecheck passes
    Failure Indicators: grep returns >0; typecheck fails with "not exported" errors
    Evidence: .sisyphus/evidence/task-5-stale-exports.txt
  ```

  **Commit**: YES (commit 5)
  - Message: `refactor: remove stale NIA_API_KEY/NIA_MCP_URL singleton exports`
  - Files: `src/config.ts`
  - Pre-commit: `bun run typecheck`

- [ ] 6. Sync CLI version from package.json

  **What to do**:
  - In `src/cli.ts`, replace the hardcoded `.version("0.1.5")` with a dynamic read from `package.json`
  - Use Bun-compatible approach: `import { readFileSync } from "node:fs"` + `JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf-8")).version` — or use a `createRequire` approach
  - Alternative (simpler): Since `resolveJsonModule: true` is already in tsconfig, try `import pkg from "../package.json" with { type: "json" }` and use `pkg.version`. NOTE: tsc may not support import attributes yet — verify with `bun run build`. If build fails, fall back to readFileSync approach.
  - TDD: Write a test in `src/cli.test.ts` that creates the program and asserts `.version()` returns a semver string matching package.json
  - Run `bun run build && bun run dist/cli.js --version` to verify

  **Must NOT do**:
  - Do NOT add new CLI commands or flags
  - Do NOT change any other CLI behavior
  - Do NOT modify tsconfig.json unless strictly necessary for JSON import

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single line change + build verification
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 5, 7, 8)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/cli.ts:278` — Hardcoded `.version("0.1.5")` that needs dynamic replacement
  - `src/cli.ts:2` — Already imports from `"node:fs"` (readFileSync available)
  - `tsconfig.json:14` — `"resolveJsonModule": true` already set
  - `src/cli/version.ts` — Existing version module (check if this already handles version — may be the intended approach)

  **WHY Each Reference Matters**:
  - The hardcoded version will drift from package.json on every release. The existing `src/cli/version.ts` file may already have infrastructure for this — check it first before adding a new approach.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CLI version matches package.json
    Tool: Bash
    Preconditions: cli.ts has dynamic version reading
    Steps:
      1. Run: bun run build
      2. Run: PKG_VERSION=$(node -e "console.log(require('./package.json').version)")
      3. Run: CLI_VERSION=$(bun run dist/cli.js --version)
      4. Assert: [ "$PKG_VERSION" = "$CLI_VERSION" ]
    Expected Result: Versions match exactly
    Failure Indicators: Version mismatch; build failure
    Evidence: .sisyphus/evidence/task-6-version-sync.txt

  Scenario: Version doesn't break after hypothetical version bump
    Tool: Bash
    Preconditions: Dynamic version reading implemented
    Steps:
      1. Run: bun run typecheck (verify the import/read compiles)
      2. Run: grep -c "0.1.5" src/cli.ts (should be 0 — no hardcoded version)
    Expected Result: Zero hardcoded version strings in cli.ts
    Failure Indicators: grep returns >0
    Evidence: .sisyphus/evidence/task-6-no-hardcoded.txt
  ```

  **Commit**: YES (commit 6)
  - Message: `fix: sync CLI version from package.json`
  - Files: `src/cli.ts` (possibly `src/cli/version.ts`)
  - Pre-commit: `bun run build && bun run dist/cli.js --version`

- [ ] 7. Align Dockerfile bun version with bun-types

  **What to do**:
  - Update `Dockerfile` line 4: change `FROM oven/bun:1.2.4-alpine` to `FROM oven/bun:1.3.11-alpine`
  - This aligns the runtime with the `bun-types: 1.3.11` devDependency in package.json
  - Verify the image exists: check Docker Hub for `oven/bun:1.3.11-alpine` tag
  - If 1.3.11 doesn't have an alpine tag, use the closest available (e.g., `oven/bun:1.3-alpine` or `oven/bun:latest`)

  **Must NOT do**:
  - Do NOT change any other Dockerfile instructions
  - Do NOT modify docker-compose.yml
  - Do NOT add multi-stage builds or other optimizations

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single line version bump
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 5, 6, 8)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `Dockerfile:4` — `FROM oven/bun:1.2.4-alpine` (version to update)
  - `package.json:43` — `"bun-types": "1.3.11"` (target version to match)

  **WHY Each Reference Matters**:
  - Runtime version should match the types version to avoid subtle API incompatibilities. Bun 1.2→1.3 is a minor bump but may include behavior changes.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Dockerfile uses correct bun version
    Tool: Bash
    Preconditions: Dockerfile currently uses bun:1.2.4
    Steps:
      1. Update FROM line to oven/bun:1.3.11-alpine (or closest available)
      2. Run: grep "FROM oven/bun:" Dockerfile
      3. If docker is available: docker build -t nia-test . (verify image builds)
    Expected Result: FROM line shows 1.3.x; docker build succeeds (if docker available)
    Failure Indicators: Build fails; image tag doesn't exist
    Evidence: .sisyphus/evidence/task-7-dockerfile-version.txt
  ```

  **Commit**: YES (commit 7)
  - Message: `fix: align Dockerfile bun version with bun-types`
  - Files: `Dockerfile`
  - Pre-commit: `grep "FROM oven/bun:" Dockerfile` (docker build if available)

- [ ] 8. Add test:unit and test:integration scripts to package.json

  **What to do**:
  - Add to `package.json` scripts:
    ```json
    "test:unit": "bun test src/",
    "test:integration": "bun test tests/integration/"
    ```
  - `test:unit` runs only co-located unit tests in `src/**/*.test.ts`
  - `test:integration` runs only integration tests in `tests/integration/**`
  - Keep existing `"test": "bun test"` unchanged (runs everything)
  - Verify both scripts work: `bun run test:unit` should pass without API key, `bun run test:integration` should run integration tests

  **Must NOT do**:
  - Do NOT remove or change the existing `"test": "bun test"` script
  - Do NOT move test files to different locations
  - Do NOT add test configuration files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 2-line addition to package.json
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 5, 6, 7)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `package.json:14-18` — Current scripts section (add new entries here)
  - `tests/integration/` — Integration test directory (6 test files confirmed)
  - `src/**/*.test.ts` — Unit test co-location pattern (28 test files in src/tools/, src/utils/, etc.)

  **WHY Each Reference Matters**:
  - `bun test` runs everything including slow integration tests (>120s timeout in CI). Splitting enables fast local iteration with `test:unit` while reserving `test:integration` for CI or explicit runs.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: test:unit runs only unit tests
    Tool: Bash
    Preconditions: New scripts added to package.json
    Steps:
      1. Run: bun run test:unit 2>&1 | tail -5
      2. Verify output shows tests from src/ only, no tests/integration/ paths
    Expected Result: Unit tests pass; no integration test files in output
    Failure Indicators: Integration test paths appear in output; script not found
    Evidence: .sisyphus/evidence/task-8-test-unit.txt

  Scenario: test:integration runs only integration tests
    Tool: Bash
    Preconditions: NIA_API_KEY set in environment
    Steps:
      1. Run: bun run test:integration 2>&1 | tail -5
      2. Verify output shows tests from tests/integration/ only
    Expected Result: Integration tests run (pass or fail based on API availability)
    Failure Indicators: Script not found; unit test paths appear
    Evidence: .sisyphus/evidence/task-8-test-integration.txt
  ```

  **Commit**: YES (commit 8)
  - Message: `chore: add test:unit and test:integration scripts`
  - Files: `package.json`
  - Pre-commit: `bun run test:unit`

- [ ] 9. Add Biome linter configuration

  **What to do**:
  - Install Biome: `bun add -d @biomejs/biome`
  - Create `biome.json` with sensible defaults that pass on the current codebase:
    - Enable linting, disable formatting (preserve existing style)
    - Set `noUnusedImports` to warn (not error — existing code may have some)
    - Exclude `node_modules/`, `dist/`
    - Use recommended rules as baseline
  - Add `"lint": "biome check src/"` script to `package.json`
  - Run `bun run lint` and fix the config until it exits 0 on current code
  - If Biome flags existing violations, adjust rule severity (warn, not error) — do NOT fix existing code

  **Must NOT do**:
  - Do NOT auto-fix any existing code
  - Do NOT enable formatting (would reformat entire codebase)
  - Do NOT add pre-commit hooks
  - Do NOT set rules to error if they fail on current code — use warn

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Config file creation + script addition
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 3, 4 in Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: F1-F4
  - **Blocked By**: None (but scheduled in Wave 2 to avoid package.json conflicts with Task 8)

  **References**:

  **Pattern References**:
  - `package.json:41-45` — devDependencies section (add @biomejs/biome here)
  - `package.json:14-18` — scripts section (add lint script here)
  - `tsconfig.json` — Biome should respect the same include/exclude patterns

  **WHY Each Reference Matters**:
  - Biome is chosen over ESLint for: speed (10-100x faster), zero-config baseline, Bun-native ecosystem compatibility, and single binary (no plugin dependencies). The linter catches dead imports, unused variables, and common mistakes automatically.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Biome is installed and lint script works
    Tool: Bash
    Preconditions: biome.json created, lint script in package.json
    Steps:
      1. Run: bun run lint
      2. Verify exit code is 0
      3. Run: test -f biome.json
    Expected Result: lint exits 0; biome.json exists
    Failure Indicators: lint exits non-zero; biome.json missing
    Evidence: .sisyphus/evidence/task-9-lint-passes.txt

  Scenario: Biome does NOT auto-fix any files (no formatter)
    Tool: Bash
    Preconditions: Biome configured with linting only
    Steps:
      1. Run: git diff --stat (before lint)
      2. Run: bun run lint
      3. Run: git diff --stat (after lint)
      4. Assert no files changed
    Expected Result: Zero files modified by lint run
    Failure Indicators: git diff shows changes after lint
    Evidence: .sisyphus/evidence/task-9-no-autofix.txt
  ```

  **Commit**: YES (commit 9)
  - Message: `chore: add Biome linter configuration`
  - Files: `biome.json`, `package.json`, `bun.lock`
  - Pre-commit: `bun run lint`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + `bun run lint` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| # | Message | Files | Pre-commit |
|---|---------|-------|------------|
| 1 | `chore: remove dead utility files (validate, permission, sse-parser)` | 6 deletions | `bun test && bun run typecheck` |
| 2 | `refactor: remove unused imports from nia-research` | `src/tools/nia-research.ts` | `bun run typecheck` |
| 3 | `refactor: extract shared NormalizedResult and formatResults to format.ts` | `src/utils/format.ts`, `src/tools/nia-search.ts`, `src/tools/nia-research.ts` | `bun test && bun run typecheck` |
| 4 | `refactor: consolidate truncateMarkdown to single shared implementation` | `src/utils/format.ts`, `src/tools/nia-search.ts` | `bun test && bun run typecheck` |
| 5 | `refactor: remove stale NIA_API_KEY/NIA_MCP_URL singleton exports` | `src/config.ts` | `bun run typecheck` |
| 6 | `fix: sync CLI version from package.json` | `src/cli.ts` | `bun run build && bun run dist/cli.js --version` |
| 7 | `fix: align Dockerfile bun version with bun-types` | `Dockerfile` | `docker build -t nia-test .` (if docker available) |
| 8 | `chore: add test:unit and test:integration scripts` | `package.json` | `bun run test:unit` |
| 9 | `chore: add Biome linter configuration` | `biome.json`, `package.json` | `bun run lint` |

---

## Success Criteria

### Verification Commands
```bash
bun test                    # Expected: all tests pass (~280 after dead test removal)
bun run typecheck           # Expected: zero errors
bun run build               # Expected: dist/ created successfully
bun run lint                # Expected: exit 0
bun run test:unit           # Expected: runs only src/**/*.test.ts
bun run test:integration    # Expected: runs only tests/integration/**
bun run dist/cli.js --version  # Expected: matches package.json version
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Total line delta is negative
- [ ] 9 atomic commits with clear messages
