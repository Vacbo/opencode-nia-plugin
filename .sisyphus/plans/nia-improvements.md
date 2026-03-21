# Nia Plugin Comprehensive Improvements

## TL;DR

> **Quick Summary**: Eliminate DRY violations, fix memory leaks, standardize all 13 tools to a robust pattern, adopt a CLI library, and harden infra — a full quality pass on the v0.1.x codebase with breaking changes allowed.
> 
> **Deliverables**:
> - Shared error/format utilities (parameterized) used by all tools
> - All 9 non-mature tools upgraded to the mature pattern (try-catch, config checks, abort handling)
> - Memory leaks fixed (TTLCache passive-purge, unbounded NiaSessionState Maps)
> - CLI argument parsing via a proper library
> - JSONC stripping bug fixed in all 3 locations
> - Nia advisor 422 bug fixed (pending API contract research)
> - Universal search timeout extended
> - Integration test coverage expanded
> - Dependencies pinned, .gitignore/.dockerignore improved
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 5 waves
> **Critical Path**: Task 1 (pin deps) → Task 3 (parameterize format.ts) → Tasks 5-13 (tool standardization) → Tasks 20-27 (integration tests) → F1-F4 (verification)

---

## Context

### Original Request
User asked to "look for improvements we can do to this project." After comprehensive exploration of the codebase with 3 parallel agents, 5 improvement areas were identified. User chose to address all 5 in a single plan.

### Interview Summary
**Key Discussions**:
- All 5 improvement areas in scope (tools, memory, tests, CLI, infra)
- TDD approach — write failing tests first, then implement
- Breaking changes freely allowed (v0.1.x, no compat constraints)
- Adopt a CLI library (commander, yargs, or citty — agent chooses)

**Research Findings**:
- `src/utils/format.ts` **already exports** `formatUnexpectedError`, `isAbortError`, `isZodError`, `inlineCode`, `stringOrFallback` — but 4 mature tools have private copies instead of importing
- `formatUnexpectedError` hardcodes `"research_error:"` prefix (format.ts:14,17) — needs parameterization
- LRU eviction in session.ts is **correct** (uses Map insertion-order with delete/re-insert) — NOT a bug
- `TriggerSession.triggeredTypes` Set is bounded by type system (max 3 values) — NOT a leak
- `OpsTracker.operations` Map has proper cleanup via `removeOperation()` — NOT a leak
- **Real leaks**: `NiaSessionState.cache` (line 38) and `NiaSessionState.projectContext` (line 36) are unbounded Maps; `TTLCache` only purges on `get()`
- JSONC stripping regex is duplicated in 3 places: `src/cli/config.ts:6`, `src/cli.ts:37-40`, `src/cli.ts:72-73`
- JSONC regex `/\/\/.*$/gm` breaks on URLs containing `//`
- `config.ts:113` module-level `configValidated` flag can't be reset between tests
- Live API confirms: advisor returns 422, universal search times out at 30s default
- 692 mock tests pass; 4/5 real API tests pass

### Metis Review
**Identified Gaps** (addressed):
- LRU eviction, smart-triggers Set, ops-tracker Map are NOT bugs — removed from plan
- format.ts already exists — task is parameterize + import, not create new file
- JSONC bug exists in 3 places, not 2 — all 3 addressed
- `NiaSessionState.cache` is a second unbounded Map (missed by initial analysis) — added to plan
- CLI has zero test coverage — added to plan
- Advisor fix needs API research first — marked as blocked dependency
- `configValidated` singleton breaks test isolation — added to plan

---

## Work Objectives

### Core Objective
Bring the entire Nia plugin codebase to a consistent quality standard: every tool follows the mature pattern, shared utilities eliminate duplication, memory is properly bounded, the CLI is robust, and tests cover all code paths.

### Concrete Deliverables
- `src/utils/format.ts` — parameterized `formatUnexpectedError` accepting tool-name prefix
- 4 mature tools (search, research, advisor, tracer) — import from shared format.ts, delete private copies
- 9 non-mature tools — upgraded with try-catch, config checks, Zod validation, abort handling
- `src/state/cache.ts` — periodic purge of expired entries
- `src/state/session.ts` — bounded `cache` and `projectContext` Maps in NiaSessionState
- `src/config.ts` — resettable `configValidated` for test isolation
- `src/cli.ts` + `src/cli/config.ts` — CLI library adoption, JSONC fix
- `src/api/client.ts` — extended timeout for universal search
- Updated integration tests for all tools
- `.gitignore`, `.dockerignore`, pinned dependencies

### Definition of Done
- [ ] `bun run typecheck` passes (zero errors)
- [ ] `bun test` completes in <30s (unit tests, no API key)
- [ ] `grep -rn "function formatUnexpectedError\|function isAbortError\|function isZodError\|function inlineCode" src/tools/` returns empty (zero private copies)
- [ ] All 13 tools have try-catch, config check, and abort handling
- [ ] `NiaSessionState.cache.size` and `NiaSessionState.projectContext.size` are bounded
- [ ] CLI `--help`, `install --no-tui --api-key`, `uninstall --no-tui` all work
- [ ] Integration tests pass for all tools with valid API key

### Must Have
- Parameterized shared error formatting (tool-name prefix)
- Try-catch + config check in ALL 13 tools
- Bounded Maps in NiaSessionState
- TTLCache periodic purge
- JSONC fix in all 3 locations
- CLI library adoption
- Pinned dependencies

### Must NOT Have (Guardrails)
- Do NOT change session.ts LRU eviction logic — it is correct
- Do NOT change smart-triggers.ts triggeredTypes Set — it is bounded by type system (max 3)
- Do NOT change ops-tracker.ts operations Map cleanup — it works correctly
- Do NOT refactor tool business logic, API calls, or response formatting while adding standard patterns
- Do NOT add new CLI commands or flags during library adoption
- Do NOT expand integration tests beyond one happy-path + one error-path per tool
- Do NOT guess the advisor API contract — research it first
- Do NOT create a new `src/utils/errors.ts` — extend the existing `format.ts`

### Canonical Error Format (ALL tools must follow)

```
{tool_name}_error: {message}     — for tool-level runtime errors
config_error: {message}          — for missing API key or disabled feature
validation_error: {message}      — for Zod validation failures
abort_error [{tool_name}]: {msg} — for user cancellation
```

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Bun test, 30 co-located *.test.ts files, 692 passing)
- **Automated tests**: YES (TDD — write failing test, implement, verify green)
- **Framework**: bun test (existing)
- **If TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test, bun run) — run tests, assert pass counts
- **CLI**: Use Bash — run CLI commands, assert exit codes and output
- **API/Integration**: Use Bash (bun test with NIA_API_KEY) — run integration tests

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — no behavior changes, MAX PARALLEL):
├── Task 1: Pin dependency versions [quick]
├── Task 2: Add .dockerignore + update .gitignore [quick]
├── Task 3: Parameterize format.ts + add tests (TDD) [quick]
└── Task 4: Make configValidated resettable + add tests (TDD) [quick]

Wave 2 (DRY Consolidation — mature tools import from format.ts):
├── Task 5: nia-search → import from shared format.ts [quick]
├── Task 6: nia-research → import from shared format.ts [quick]
├── Task 7: nia-advisor → import from shared format.ts [quick]
└── Task 8: nia-tracer → import from shared format.ts [quick]

Wave 3 (Tool Standardization — 9 non-mature tools, MAX PARALLEL):
├── Task 9: Standardize nia-read [quick]
├── Task 10: Standardize nia-grep [quick]
├── Task 11: Standardize nia-explore [quick]
├── Task 12: Standardize nia-index [quick]
├── Task 13: Standardize nia-manage-resource [quick]
├── Task 14: Standardize nia-context [quick]
├── Task 15: Standardize nia-package-search [quick]
├── Task 16: Standardize nia-auto-subscribe [quick]
└── Task 17: Standardize nia-e2e [quick]

Wave 4 (Bug Fixes + CLI — partially parallel):
├── Task 18: Fix TTLCache passive-purge + bound NiaSessionState Maps (TDD) [unspecified-high]
├── Task 19: Fix JSONC stripping + deduplicate in cli.ts (TDD) [quick]
├── Task 20: Extend universal search timeout in client.ts (TDD) [quick]
├── Task 21: Research Nia advisor API contract [deep]
├── Task 22: Fix nia_advisor request shape (blocked by Task 21) [quick]
└── Task 23: Adopt CLI library + add CLI tests (TDD) [unspecified-high]

Wave 5 (Integration Test Expansion):
├── Task 24: Add integration tests for nia-read, nia-grep, nia-explore [unspecified-high]
├── Task 25: Add integration tests for nia-context, nia-package-search [unspecified-high]
├── Task 26: Add integration tests for nia-auto-subscribe, nia-tracer [unspecified-high]
└── Task 27: Add integration tests for nia-e2e [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Critical Path
Task 1 → Task 3 → Tasks 5-8 → Tasks 9-17 → Task 18 → F1-F4 → user okay

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 3-27 (pin deps first) |
| 2 | — | — |
| 3 | 1 | 5-17 (tools need parameterized format.ts) |
| 4 | 1 | 18 (cache tests need resettable config) |
| 5-8 | 3 | 9-17 (consolidation proves pattern) |
| 9-17 | 5-8 | 24-27 |
| 18 | 4 | — |
| 19 | 1 | 23 |
| 20 | 1 | — |
| 21 | — | 22 |
| 22 | 21 | — |
| 23 | 19 | — |
| 24-27 | 9-17 | F1-F4 |
| F1-F4 | ALL | user okay |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks → T1 `quick`, T2 `quick`, T3 `quick`, T4 `quick`
- **Wave 2**: 4 tasks → T5-T8 all `quick`
- **Wave 3**: 9 tasks → T9-T17 all `quick`
- **Wave 4**: 6 tasks → T18 `unspecified-high`, T19 `quick`, T20 `quick`, T21 `deep`, T22 `quick`, T23 `unspecified-high`
- **Wave 5**: 4 tasks → T24-T27 all `unspecified-high`
- **FINAL**: 4 tasks → F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. Pin dependency versions in package.json

  **What to do**:
  - Run `bun install` to resolve current versions
  - Replace `"latest"` for `@opencode-ai/plugin` with the resolved exact version (e.g., `"^1.2.0"`)
  - Replace `"latest"` for `bun-types` with the resolved exact version (e.g., `"~1.2.4"`)
  - Keep `@opencode-ai/sdk` range as-is (already `^1.2.22`)
  - Verify build still works

  **Must NOT do**:
  - Do not upgrade to newer major versions
  - Do not change `@opencode-ai/sdk` version range

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 3-27 (all code changes should happen after deps are pinned)
  - **Blocked By**: None

  **References**:
  - `package.json:37-38` — current `"latest"` entries for `@opencode-ai/plugin` and `bun-types`
  - `bun.lock` — resolved versions already recorded here

  **Acceptance Criteria**:
  - [ ] `grep '"latest"' package.json` returns empty
  - [ ] `bun run typecheck` passes
  - [ ] `bun test` passes

  **QA Scenarios**:

  ```
  Scenario: Dependencies pinned and build works
    Tool: Bash
    Preconditions: Fresh checkout
    Steps:
      1. Run `grep '"latest"' package.json` — assert empty output
      2. Run `bun run typecheck` — assert exit code 0
      3. Run `bun test --timeout 60000` — assert exit code 0
    Expected Result: No "latest" in package.json, build and tests pass
    Failure Indicators: grep returns matches, typecheck fails, tests fail
    Evidence: .sisyphus/evidence/task-1-deps-pinned.txt
  ```

  **Commit**: YES
  - Message: `chore: pin dependency versions`
  - Files: `package.json`, `bun.lock`
  - Pre-commit: `bun run typecheck`

- [x] 2. Add .dockerignore and update .gitignore

  **What to do**:
  - Create `.dockerignore` with: `.git/`, `node_modules/`, `dist/`, `.sisyphus/`, `test-results/`, `*.log`, `.DS_Store`, `.env`
  - Update `.gitignore` to add: `.env`, `.sisyphus/evidence/`, `test-results/`
  - Do NOT add `.sisyphus/` itself to .gitignore (plans/drafts should be tracked)

  **Must NOT do**:
  - Do not remove any existing .gitignore entries
  - Do not modify Dockerfile or docker-compose.yml

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `.gitignore` — current 4-line file
  - `Dockerfile:16-21` — COPY commands that would benefit from .dockerignore
  - `docker-compose.yml:28-30` — volume mounts

  **Acceptance Criteria**:
  - [ ] `.dockerignore` exists with required entries
  - [ ] `.gitignore` includes `.env`, `.sisyphus/evidence/`, `test-results/`
  - [ ] `.gitignore` does NOT include `.sisyphus/` (plans should be tracked)

  **QA Scenarios**:

  ```
  Scenario: Docker build context is smaller
    Tool: Bash
    Preconditions: .dockerignore created
    Steps:
      1. Run `cat .dockerignore` — assert contains `.git/`, `node_modules/`, `dist/`
      2. Run `cat .gitignore` — assert contains `.env`, `test-results/`
      3. Run `grep -c "^\.sisyphus/$" .gitignore` — assert 0 (not ignoring plans)
    Expected Result: Both files exist with correct entries
    Failure Indicators: Missing entries or .sisyphus/ fully ignored
    Evidence: .sisyphus/evidence/task-2-ignore-files.txt
  ```

  **Commit**: YES
  - Message: `chore: add .dockerignore, update .gitignore`
  - Files: `.dockerignore`, `.gitignore`
  - Pre-commit: —

- [x] 3. Parameterize formatUnexpectedError in format.ts (TDD)

  **What to do**:
  - RED: Write tests in `src/utils/format.test.ts` for a new `createToolErrorFormatter(toolName)` function that returns a `formatUnexpectedError` function with the tool name as prefix
  - Also test: `formatUnexpectedError("search", error, true)` returns `"aborted"`, `formatUnexpectedError("search", zodError, false)` returns `"validation_error: ..."`, `formatUnexpectedError("search", new Error("fail"), false)` returns `"search_error: fail"`
  - GREEN: Update `src/utils/format.ts` to accept an optional `toolName` parameter (default `"unknown"`) so output is `"{toolName}_error: {message}"` instead of hardcoded `"research_error:"`
  - Maintain backward compatibility: existing signature `formatUnexpectedError(error, wasAborted)` still works (defaults to `"unknown"`)
  - Add a convenience factory: `export function createToolErrorFormatter(toolName: string)` that returns a bound version
  - REFACTOR: Ensure all existing format.test.ts tests still pass

  **Must NOT do**:
  - Do not create a new `src/utils/errors.ts` file — everything goes in format.ts
  - Do not change any tool files in this task (that's Tasks 5-17)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Tasks 5-17 (all tool consolidation/standardization uses this)
  - **Blocked By**: Task 1 (pinned deps)

  **References**:
  - `src/utils/format.ts:4-18` — current `formatUnexpectedError` with hardcoded `"research_error:"` at lines 14 and 17
  - `src/utils/format.ts:20-45` — other shared helpers (isAbortError, isZodError, inlineCode, stringOrFallback)
  - `src/utils/format.test.ts` — existing tests to not break
  - `src/tools/nia-search.ts:264-291` — private copy showing the pattern each tool uses (with `search_error:` prefix)

  **Acceptance Criteria**:
  - [ ] `formatUnexpectedError(error, wasAborted)` still works (backward compat)
  - [ ] `formatUnexpectedError(error, wasAborted, "search")` uses `"search_error:"` prefix
  - [ ] `createToolErrorFormatter("search")` returns bound function
  - [ ] `bun test src/utils/format.test.ts` passes with new + old tests

  **QA Scenarios**:

  ```
  Scenario: Parameterized error formatting works
    Tool: Bash
    Preconditions: format.ts updated with parameterized function
    Steps:
      1. Run `bun test src/utils/format.test.ts` — assert all tests pass
      2. Run `grep "research_error" src/utils/format.ts` — assert NO hardcoded research_error remains
      3. Run `grep "createToolErrorFormatter" src/utils/format.ts` — assert function exists
    Expected Result: All tests pass, no hardcoded prefix, factory exported
    Failure Indicators: Tests fail, hardcoded prefix still present
    Evidence: .sisyphus/evidence/task-3-format-parameterized.txt

  Scenario: Backward compatibility preserved
    Tool: Bash
    Preconditions: format.ts updated
    Steps:
      1. Run `bun test src/utils/format.test.ts -t "formatUnexpectedError"` — assert existing tests pass
    Expected Result: Old tests still green
    Failure Indicators: Existing tests break
    Evidence: .sisyphus/evidence/task-3-format-backcompat.txt
  ```

  **Commit**: YES
  - Message: `feat(format): parameterize formatUnexpectedError with tool prefix`
  - Files: `src/utils/format.ts`, `src/utils/format.test.ts`
  - Pre-commit: `bun test src/utils/format.test.ts`

- [x] 4. Make configValidated resettable for test isolation (TDD)

  **What to do**:
  - RED: Write test in `src/config.test.ts` that calls `resetConfigValidation()`, then `loadConfig()`, and asserts validation runs again (captures console.warn)
  - GREEN: Export a `resetConfigValidation()` function from `src/config.ts` that sets `configValidated = false`
  - REFACTOR: Ensure existing config tests still pass

  **Must NOT do**:
  - Do not change validation logic itself
  - Do not expose `configValidated` directly

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 18 (cache/session tests need isolated config)
  - **Blocked By**: Task 1 (pinned deps)

  **References**:
  - `src/config.ts:113` — module-level `let configValidated = false` singleton
  - `src/config.ts:139-145` — the `if (!configValidated)` guard in loadConfig
  - `src/config.test.ts` — existing tests

  **Acceptance Criteria**:
  - [ ] `resetConfigValidation` exported from config.ts
  - [ ] Calling it allows `loadConfig()` to re-run validation
  - [ ] `bun test src/config.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: Config validation can be reset between tests
    Tool: Bash
    Steps:
      1. Run `bun test src/config.test.ts` — assert all pass
      2. Run `grep "resetConfigValidation" src/config.ts` — assert exported
    Expected Result: Tests pass, function exported
    Evidence: .sisyphus/evidence/task-4-config-reset.txt
  ```

  **Commit**: YES
  - Message: `fix(config): make configValidated resettable for tests`
  - Files: `src/config.ts`, `src/config.test.ts`
  - Pre-commit: `bun test src/config.test.ts`

- [x] 5. nia-search: import from shared format.ts, delete private copies

  **What to do**:
  - RED: Add test asserting nia-search error output uses `"search_error:"` prefix (may already exist)
  - GREEN: In `src/tools/nia-search.ts`, delete the private functions: `formatUnexpectedError` (lines 264-278), `isAbortError` (lines 280-282), `isZodError` (lines 284-291), `inlineCode` (lines 260-262), `stringOrFallback` (lines 250-258)
  - Import from `src/utils/format.ts`: `createToolErrorFormatter`, `isAbortError`, `isZodError`, `inlineCode`, `stringOrFallback`
  - Create `const formatError = createToolErrorFormatter("search")` and use it in the catch block
  - REFACTOR: Verify all existing nia-search tests still pass

  **Must NOT do**:
  - Do not change nia-search business logic, API calls, or response formatting
  - Do not change any other tool file in this task

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8)
  - **Blocks**: Tasks 9-17 (proves the pattern)
  - **Blocked By**: Task 3 (parameterized format.ts)

  **References**:
  - `src/tools/nia-search.ts:250-291` — private copies to delete
  - `src/tools/nia-search.ts:63-91` — try-catch block that calls formatUnexpectedError
  - `src/utils/format.ts` — shared source of truth

  **Acceptance Criteria**:
  - [ ] `grep -c "function formatUnexpectedError\|function isAbortError\|function isZodError\|function inlineCode\|function stringOrFallback" src/tools/nia-search.ts` returns `0`
  - [ ] `grep "from.*format" src/tools/nia-search.ts` shows import from `../utils/format.js`
  - [ ] `bun test src/tools/nia-search.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: Private copies removed, shared imports work
    Tool: Bash
    Steps:
      1. Run `grep -c "function formatUnexpectedError\|function isAbortError" src/tools/nia-search.ts` — assert 0
      2. Run `grep "from.*format" src/tools/nia-search.ts` — assert import exists
      3. Run `bun test src/tools/nia-search.test.ts` — assert all pass
    Expected Result: Zero private copies, import present, tests green
    Evidence: .sisyphus/evidence/task-5-search-dry.txt
  ```

  **Commit**: YES
  - Message: `refactor(search): import shared format utilities from format.ts`
  - Files: `src/tools/nia-search.ts`
  - Pre-commit: `bun test src/tools/nia-search.test.ts`

- [x] 6. nia-research: import from shared format.ts, delete private copies

  **What to do**:
  - Same pattern as Task 5, but for `src/tools/nia-research.ts`
  - Delete private functions at lines 355-396 (stringOrFallback, inlineCode, formatUnexpectedError, isAbortError, isZodError)
  - Import from format.ts, use `createToolErrorFormatter("research")`

  **Must NOT do**: Same guardrails as Task 5

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 2 (with 5, 7, 8)
  - **Blocks**: Tasks 9-17 — **Blocked By**: Task 3

  **References**:
  - `src/tools/nia-research.ts:355-396` — private copies to delete
  - `src/tools/nia-research.ts:71-152` — try-catch block

  **Acceptance Criteria**:
  - [ ] `grep -c "function formatUnexpectedError\|function isAbortError\|function isZodError" src/tools/nia-research.ts` returns `0`
  - [ ] `bun test src/tools/nia-research.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: Private copies removed from nia-research
    Tool: Bash
    Steps:
      1. Run `grep -c "function formatUnexpectedError" src/tools/nia-research.ts` — assert 0
      2. Run `bun test src/tools/nia-research.test.ts` — assert all pass
    Expected Result: Zero private copies, tests green
    Evidence: .sisyphus/evidence/task-6-research-dry.txt
  ```

  **Commit**: YES
  - Message: `refactor(research): import shared format utilities from format.ts`
  - Files: `src/tools/nia-research.ts`
  - Pre-commit: `bun test src/tools/nia-research.test.ts`

- [x] 7. nia-advisor: import from shared format.ts, delete private copies

  **What to do**:
  - Same pattern as Task 5, but for `src/tools/nia-advisor.ts`
  - Delete private functions at lines 113-144 (inlineCode, formatUnexpectedError, isAbortError, isZodError)
  - Import from format.ts, use `createToolErrorFormatter("advisor")`

  **Must NOT do**: Same guardrails as Task 5

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 2 (with 5, 6, 8)
  - **Blocks**: Tasks 9-17 — **Blocked By**: Task 3

  **References**:
  - `src/tools/nia-advisor.ts:113-144` — private copies to delete
  - `src/tools/nia-advisor.ts:32-55` — try-catch block

  **Acceptance Criteria**:
  - [ ] `grep -c "function formatUnexpectedError" src/tools/nia-advisor.ts` returns `0`
  - [ ] `bun test src/tools/nia-advisor.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: Private copies removed from nia-advisor
    Tool: Bash
    Steps:
      1. Run `grep -c "function formatUnexpectedError" src/tools/nia-advisor.ts` — assert 0
      2. Run `bun test src/tools/nia-advisor.test.ts` — assert all pass
    Expected Result: Zero private copies, tests green
    Evidence: .sisyphus/evidence/task-7-advisor-dry.txt
  ```

  **Commit**: YES
  - Message: `refactor(advisor): import shared format utilities from format.ts`
  - Files: `src/tools/nia-advisor.ts`
  - Pre-commit: `bun test src/tools/nia-advisor.test.ts`

- [x] 8. nia-tracer: import from shared format.ts, delete private copies

  **What to do**:
  - Same pattern as Task 5, but for `src/tools/nia-tracer.ts`
  - Delete private functions at lines 259-290 (inlineCode, formatUnexpectedError, isAbortError, isZodError)
  - Import from format.ts, use `createToolErrorFormatter("tracer")`
  - Also fix the `any` type in superRefine at line 52 — use proper typed argument

  **Must NOT do**: Same guardrails as Task 5

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 2 (with 5, 6, 7)
  - **Blocks**: Tasks 9-17 — **Blocked By**: Task 3

  **References**:
  - `src/tools/nia-tracer.ts:259-290` — private copies to delete
  - `src/tools/nia-tracer.ts:52` — `any` type in superRefine
  - `src/tools/nia-tracer.ts:69-146` — try-catch block

  **Acceptance Criteria**:
  - [ ] `grep -c "function formatUnexpectedError" src/tools/nia-tracer.ts` returns `0`
  - [ ] `grep -c ": any" src/tools/nia-tracer.ts` returns `0` (no `any` types)
  - [ ] `bun test src/tools/nia-tracer.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: Private copies removed and any type fixed in nia-tracer
    Tool: Bash
    Steps:
      1. Run `grep -c "function formatUnexpectedError" src/tools/nia-tracer.ts` — assert 0
      2. Run `grep -c ": any" src/tools/nia-tracer.ts` — assert 0
      3. Run `bun test src/tools/nia-tracer.test.ts` — assert all pass
    Expected Result: Zero private copies, no any types, tests green
    Evidence: .sisyphus/evidence/task-8-tracer-dry.txt
  ```

  **Commit**: YES
  - Message: `refactor(tracer): import shared format utilities, fix any type`
  - Files: `src/tools/nia-tracer.ts`
  - Pre-commit: `bun test src/tools/nia-tracer.test.ts`

- [x] 9. Standardize nia-read to mature pattern (TDD)

  **What to do**:
  - RED: Add tests to `src/tools/nia-read.test.ts` for: (a) returns `config_error` when apiKey missing, (b) returns `config_error` when feature disabled, (c) catches and formats errors via shared formatter, (d) handles abort signal
  - GREEN: Wrap execute body in try-catch. Add config checks at top (apiKey, searchEnabled). Add abort signal check. Import `createToolErrorFormatter("read")` from format.ts. Use canonical error format.
  - Replace magic number `50 * 1024` with named constant `MAX_CONTENT_BYTES`
  - REFACTOR: Ensure all existing nia-read tests still pass

  **Must NOT do**:
  - Do not change API call logic, response formatting, or source resolution
  - Do not add Zod schema validation (tool uses resolveSource which already validates)

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 3 (with Tasks 10-17)
  - **Blocks**: Task 24 (integration tests) — **Blocked By**: Tasks 5-8 (Wave 2)

  **References**:
  - `src/tools/nia-read.ts:31-69` — current execute function (no try-catch, no config checks)
  - `src/tools/nia-read.ts:7` — magic number `50 * 1024`
  - `src/tools/nia-search.ts:63-91` — PATTERN TO FOLLOW (try-catch + config check + abort)
  - `src/tools/source-resolver.ts` — used by nia-read, already handles its own validation

  **Acceptance Criteria**:
  - [ ] `grep "try {" src/tools/nia-read.ts` returns a match (has try-catch)
  - [ ] `grep "config_error" src/tools/nia-read.ts` returns a match (has config check)
  - [ ] `grep "MAX_CONTENT_BYTES" src/tools/nia-read.ts` returns a match (named constant)
  - [ ] `bun test src/tools/nia-read.test.ts` passes (new + old tests)

  **QA Scenarios**:

  ```
  Scenario: nia-read handles errors and config checks
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-read.test.ts` — assert all pass
      2. Run `grep -c "try {" src/tools/nia-read.ts` — assert >= 1
      3. Run `grep -c "config_error" src/tools/nia-read.ts` — assert >= 1
    Expected Result: Tests pass, error handling present
    Evidence: .sisyphus/evidence/task-9-read-standard.txt

  Scenario: Config disabled returns config_error
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-read.test.ts -t "config"` — assert passes
    Expected Result: Config error test exists and passes
    Evidence: .sisyphus/evidence/task-9-read-config.txt
  ```

  **Commit**: YES
  - Message: `feat(read): standardize nia-read with error handling and config checks`
  - Files: `src/tools/nia-read.ts`, `src/tools/nia-read.test.ts`
  - Pre-commit: `bun test src/tools/nia-read.test.ts`

- [x] 10. Standardize nia-grep to mature pattern (TDD)

  **What to do**:
  - Same standardization pattern as Task 9, but for `src/tools/nia-grep.ts`
  - Add try-catch, config checks, abort handling, import shared formatters
  - Use `createToolErrorFormatter("grep")`

  **Must NOT do**: Do not change API call logic, response formatting, or source resolution

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 3 (with Tasks 9, 11-17)
  - **Blocks**: Task 24 — **Blocked By**: Tasks 5-8

  **References**:
  - `src/tools/nia-grep.ts:37-78` — current execute function
  - `src/tools/nia-search.ts:63-91` — PATTERN TO FOLLOW

  **Acceptance Criteria**:
  - [ ] Has try-catch, config check, abort handling
  - [ ] `bun test src/tools/nia-grep.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: nia-grep standardized
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-grep.test.ts` — assert all pass
      2. Run `grep -c "try {" src/tools/nia-grep.ts` — assert >= 1
    Expected Result: Tests pass, error handling present
    Evidence: .sisyphus/evidence/task-10-grep-standard.txt
  ```

  **Commit**: YES
  - Message: `feat(grep): standardize nia-grep with error handling and config checks`
  - Files: `src/tools/nia-grep.ts`, `src/tools/nia-grep.test.ts`
  - Pre-commit: `bun test src/tools/nia-grep.test.ts`

- [x] 11. Standardize nia-explore to mature pattern (TDD)

  **What to do**: Same as Task 9 for `src/tools/nia-explore.ts`. Use `createToolErrorFormatter("explore")`.

  **Must NOT do**: Do not change API call logic, tree formatting, or source resolution

  **Recommended Agent Profile**: **Category**: `quick` — **Skills**: []

  **Parallelization**: Wave 3 parallel. **Blocks**: Task 24. **Blocked By**: Tasks 5-8.

  **References**:
  - `src/tools/nia-explore.ts:47-72` — current execute function
  - `src/tools/nia-search.ts:63-91` — PATTERN TO FOLLOW

  **Acceptance Criteria**:
  - [ ] Has try-catch, config check, abort handling
  - [ ] `bun test src/tools/nia-explore.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: nia-explore standardized
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-explore.test.ts` — assert all pass
      2. Run `grep -c "try {" src/tools/nia-explore.ts` — assert >= 1
    Expected Result: Tests pass, error handling present
    Evidence: .sisyphus/evidence/task-11-explore-standard.txt
  ```

  **Commit**: YES
  - Message: `feat(explore): standardize nia-explore with error handling and config checks`
  - Files: `src/tools/nia-explore.ts`, `src/tools/nia-explore.test.ts`
  - Pre-commit: `bun test src/tools/nia-explore.test.ts`

- [x] 12. Standardize nia-index to mature pattern (TDD)

  **What to do**: Same as Task 9 for `src/tools/nia-index.ts`. Use `createToolErrorFormatter("index")`.

  **Must NOT do**: Do not change source type detection, URL normalization, or session state tracking

  **Recommended Agent Profile**: **Category**: `quick` — **Skills**: []

  **Parallelization**: Wave 3 parallel. **Blocks**: Task 24. **Blocked By**: Tasks 5-8.

  **References**:
  - `src/tools/nia-index.ts:110-145` — current execute function
  - `src/tools/nia-search.ts:63-91` — PATTERN TO FOLLOW

  **Acceptance Criteria**:
  - [ ] Has try-catch, config check, abort handling
  - [ ] `bun test src/tools/nia-index.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: nia-index standardized
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-index.test.ts` — assert all pass
      2. Run `grep -c "try {" src/tools/nia-index.ts` — assert >= 1
    Expected Result: Tests pass, error handling present
    Evidence: .sisyphus/evidence/task-12-index-standard.txt
  ```

  **Commit**: YES
  - Message: `feat(index): standardize nia-index with error handling and config checks`
  - Files: `src/tools/nia-index.ts`, `src/tools/nia-index.test.ts`
  - Pre-commit: `bun test src/tools/nia-index.test.ts`

- [x] 13. Standardize nia-manage-resource to mature pattern (TDD)

  **What to do**: Same as Task 9 for `src/tools/nia-manage-resource.ts`. Use `createToolErrorFormatter("manage_resource")`.

  **Must NOT do**: Do not change action routing, permission checks, or switch statement logic

  **Recommended Agent Profile**: **Category**: `quick` — **Skills**: []

  **Parallelization**: Wave 3 parallel. **Blocks**: Task 25. **Blocked By**: Tasks 5-8.

  **References**:
  - `src/tools/nia-manage-resource.ts:115-217` — current execute with switch statement
  - `src/tools/nia-search.ts:63-91` — PATTERN TO FOLLOW

  **Acceptance Criteria**:
  - [ ] Has try-catch, config check, abort handling
  - [ ] `bun test src/tools/nia-manage-resource.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: nia-manage-resource standardized
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-manage-resource.test.ts` — assert all pass
      2. Run `grep -c "try {" src/tools/nia-manage-resource.ts` — assert >= 1
    Expected Result: Tests pass, error handling present
    Evidence: .sisyphus/evidence/task-13-manage-standard.txt
  ```

  **Commit**: YES
  - Message: `feat(manage-resource): standardize with error handling and config checks`
  - Files: `src/tools/nia-manage-resource.ts`, `src/tools/nia-manage-resource.test.ts`
  - Pre-commit: `bun test src/tools/nia-manage-resource.test.ts`

- [x] 14. Standardize nia-context to mature pattern (TDD)

  **What to do**: Same as Task 9 for `src/tools/nia-context.ts`. Use `createToolErrorFormatter("context")`.
  - Also fix unsafe `as ContextAction` cast at line 173 — add runtime validation

  **Must NOT do**: Do not change action handler dispatch, context save/load/search logic

  **Recommended Agent Profile**: **Category**: `quick` — **Skills**: []

  **Parallelization**: Wave 3 parallel. **Blocks**: Task 25. **Blocked By**: Tasks 5-8.

  **References**:
  - `src/tools/nia-context.ts:172-179` — current execute function with unsafe cast
  - `src/tools/nia-context.ts:146-153` — ACTION_HANDLERS pattern
  - `src/tools/nia-search.ts:63-91` — PATTERN TO FOLLOW

  **Acceptance Criteria**:
  - [ ] Has try-catch, config check, abort handling
  - [ ] No unsafe `as ContextAction` cast (uses runtime check or Zod)
  - [ ] `bun test src/tools/nia-context.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: nia-context standardized, unsafe cast removed
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-context.test.ts` — assert all pass
      2. Run `grep -c "as ContextAction" src/tools/nia-context.ts` — assert 0
    Expected Result: Tests pass, no unsafe casts
    Evidence: .sisyphus/evidence/task-14-context-standard.txt
  ```

  **Commit**: YES
  - Message: `feat(context): standardize with error handling, remove unsafe cast`
  - Files: `src/tools/nia-context.ts`, `src/tools/nia-context.test.ts`
  - Pre-commit: `bun test src/tools/nia-context.test.ts`

- [x] 15. Standardize nia-package-search to mature pattern (TDD)

  **What to do**: Same as Task 9 for `src/tools/nia-package-search.ts`. Use `createToolErrorFormatter("package_search")`.

  **Must NOT do**: Do not change search logic or result formatting

  **Recommended Agent Profile**: **Category**: `quick` — **Skills**: []

  **Parallelization**: Wave 3 parallel. **Blocks**: Task 25. **Blocked By**: Tasks 5-8.

  **References**:
  - `src/tools/nia-package-search.ts:66-98` — current execute function
  - `src/tools/nia-search.ts:63-91` — PATTERN TO FOLLOW

  **Acceptance Criteria**:
  - [ ] Has try-catch, config check, abort handling
  - [ ] `bun test src/tools/nia-package-search.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: nia-package-search standardized
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-package-search.test.ts` — assert all pass
      2. Run `grep -c "try {" src/tools/nia-package-search.ts` — assert >= 1
    Expected Result: Tests pass, error handling present
    Evidence: .sisyphus/evidence/task-15-package-search-standard.txt
  ```

  **Commit**: YES
  - Message: `feat(package-search): standardize with error handling and config checks`
  - Files: `src/tools/nia-package-search.ts`, `src/tools/nia-package-search.test.ts`
  - Pre-commit: `bun test src/tools/nia-package-search.test.ts`

- [x] 16. Standardize nia-auto-subscribe to mature pattern (TDD)

  **What to do**: Same as Task 9 for `src/tools/nia-auto-subscribe.ts`. Use `createToolErrorFormatter("auto_subscribe")`.

  **Must NOT do**: Do not change manifest parsing or subscription logic

  **Recommended Agent Profile**: **Category**: `quick` — **Skills**: []

  **Parallelization**: Wave 3 parallel. **Blocks**: Task 26. **Blocked By**: Tasks 5-8.

  **References**:
  - `src/tools/nia-auto-subscribe.ts:51-95` — current execute function
  - `src/tools/nia-search.ts:63-91` — PATTERN TO FOLLOW

  **Acceptance Criteria**:
  - [ ] Has try-catch, config check, abort handling
  - [ ] `bun test src/tools/nia-auto-subscribe.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: nia-auto-subscribe standardized
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-auto-subscribe.test.ts` — assert all pass
      2. Run `grep -c "try {" src/tools/nia-auto-subscribe.ts` — assert >= 1
    Expected Result: Tests pass, error handling present
    Evidence: .sisyphus/evidence/task-16-auto-subscribe-standard.txt
  ```

  **Commit**: YES
  - Message: `feat(auto-subscribe): standardize with error handling and config checks`
  - Files: `src/tools/nia-auto-subscribe.ts`, `src/tools/nia-auto-subscribe.test.ts`
  - Pre-commit: `bun test src/tools/nia-auto-subscribe.test.ts`

- [x] 17. Standardize nia-e2e to mature pattern (TDD)

  **What to do**: Same as Task 9 for `src/tools/nia-e2e.ts`. Use `createToolErrorFormatter("e2e")`.
  - Also fix unsafe `as E2EAction` cast at line 174 — add runtime validation
  - Fix the `return undefined` pattern at line 150-151 — return a proper disabled message instead

  **Must NOT do**: Do not change E2E session logic, sync logic, or action handlers

  **Recommended Agent Profile**: **Category**: `quick` — **Skills**: []

  **Parallelization**: Wave 3 parallel. **Blocks**: Task 27. **Blocked By**: Tasks 5-8.

  **References**:
  - `src/tools/nia-e2e.ts:173-180` — current execute with unsafe cast
  - `src/tools/nia-e2e.ts:149-151` — returns undefined when disabled (should return tool with error message)
  - `src/tools/nia-search.ts:63-91` — PATTERN TO FOLLOW

  **Acceptance Criteria**:
  - [ ] Has try-catch, config check, abort handling
  - [ ] No unsafe `as E2EAction` cast
  - [ ] Does NOT return `undefined` — always returns a tool definition
  - [ ] `bun test src/tools/nia-e2e.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: nia-e2e standardized, unsafe patterns removed
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-e2e.test.ts` — assert all pass
      2. Run `grep -c "as E2EAction" src/tools/nia-e2e.ts` — assert 0
      3. Run `grep -c "return undefined" src/tools/nia-e2e.ts` — assert 0
    Expected Result: Tests pass, no unsafe patterns
    Evidence: .sisyphus/evidence/task-17-e2e-standard.txt
  ```

  **Commit**: YES
  - Message: `feat(e2e): standardize with error handling, remove unsafe patterns`
  - Files: `src/tools/nia-e2e.ts`, `src/tools/nia-e2e.test.ts`
  - Pre-commit: `bun test src/tools/nia-e2e.test.ts`

- [x] 18. Fix TTLCache passive-purge + bound NiaSessionState Maps (TDD)

  **What to do**:
  - RED: Add tests to `src/state/cache.test.ts`: (a) expired entries are purged on `set()` (not just `get()`), (b) cache respects a max size limit
  - RED: Add tests to `src/state/session.test.ts`: (a) `NiaSessionState.cache` has a max size, (b) `NiaSessionState.projectContext` has a max size, (c) LRU eviction when cache exceeds bound
  - GREEN in `src/state/cache.ts`: Add periodic purge — on every `set()`, scan and remove expired entries if a check interval has elapsed (e.g., every 10 sets). Add a `maxSize` option.
  - GREEN in `src/state/session.ts`: Set `maxSize` bounds for `cache` (e.g., 500) and `projectContext` (e.g., 100). Use TTLCache or a bounded Map with LRU.
  - REFACTOR: Ensure existing tests still pass

  **Must NOT do**:
  - Do NOT change LRU eviction in SESSION_STATES (it is correct)
  - Do NOT change OpsTracker cleanup (it works correctly)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 4 (with Tasks 19-23)
  - **Blocks**: None — **Blocked By**: Task 4 (resettable configValidated)

  **References**:
  - `src/state/cache.ts:21-34` — current `get()` only purge
  - `src/state/session.ts:36-38` — unbounded `projectContext` and `cache` Maps
  - `src/state/session.ts:94-108` — correct LRU eviction (DO NOT CHANGE)

  **Acceptance Criteria**:
  - [ ] `TTLCache` purges expired entries during `set()`, not only on `get()`
  - [ ] `NiaSessionState.cache` has a max size
  - [ ] `NiaSessionState.projectContext` has a max size
  - [ ] `bun test src/state/` passes

  **QA Scenarios**:

  ```
  Scenario: TTLCache purges on set
    Tool: Bash
    Steps:
      1. Run `bun test src/state/cache.test.ts` — assert all pass
      2. Run `bun test src/state/session.test.ts` — assert all pass
    Expected Result: All state tests pass including new boundary tests
    Evidence: .sisyphus/evidence/task-18-state-bounds.txt

  Scenario: NiaSessionState Maps are bounded
    Tool: Bash
    Steps:
      1. Run `bun test src/state/session.test.ts -t "bounded"` — assert passes
    Expected Result: Bounded map tests exist and pass
    Evidence: .sisyphus/evidence/task-18-session-bounds.txt
  ```

  **Commit**: YES
  - Message: `fix(state): add TTLCache cleanup on set, bound NiaSessionState Maps`
  - Files: `src/state/cache.ts`, `src/state/cache.test.ts`, `src/state/session.ts`, `src/state/session.test.ts`
  - Pre-commit: `bun test src/state/`

- [x] 19. Fix JSONC stripping + deduplicate across cli.ts (TDD)

  **What to do**:
  - RED: Add tests to a new `src/cli/config.test.ts` (CLI config, not main config): (a) `stripJsoncComments` handles URLs containing `//` correctly, (b) handles multi-line comments `/* */`, (c) preserves strings with `//` inside them
  - GREEN: Replace the regex in `src/cli/config.ts:6` with a proper JSONC-aware stripper (iterate character by character, track string context, only strip comments outside strings)
  - GREEN: In `src/cli.ts`, replace inline JSONC stripping at lines 37-40 and 72-73 with `import { stripJsoncComments } from "./cli/config.js"` calls
  - REFACTOR: Verify URLs like `"https://apigcp.trynia.ai/v2"` survive stripping

  **Must NOT do**:
  - Do not add a JSONC library dependency — implement inline (it's small)
  - Do not change CLI logic beyond the JSONC fix

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 4
  - **Blocks**: Task 23 (CLI adoption) — **Blocked By**: Task 1

  **References**:
  - `src/cli/config.ts:5-7` — current broken `stripJsoncComments` (regex `/\/\/.*$/gm`)
  - `src/cli.ts:37-40` — duplicate #1 inline JSONC stripping
  - `src/cli.ts:72-73` — duplicate #2 inline JSONC stripping
  - `src/cli/config.ts:24-34` — `readOpencodeConfig` that uses it

  **Acceptance Criteria**:
  - [ ] `stripJsoncComments('{"url":"https://example.com/v2"}')` preserves the URL
  - [ ] `grep -c "replace.*\/\/" src/cli.ts` returns `0` (no inline JSONC stripping)
  - [ ] `bun test src/cli/config.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: JSONC stripping preserves URLs
    Tool: Bash
    Steps:
      1. Run `bun test src/cli/config.test.ts` — assert all pass
      2. Run `grep -c "replace.*\/\/" src/cli.ts` — assert 0 (inline duplication removed)
    Expected Result: JSONC tests pass, no inline duplication
    Evidence: .sisyphus/evidence/task-19-jsonc-fix.txt

  Scenario: URL with // not stripped
    Tool: Bash
    Steps:
      1. Run `bun test src/cli/config.test.ts -t "URL"` — assert passes
    Expected Result: URL preservation test exists and passes
    Evidence: .sisyphus/evidence/task-19-jsonc-url.txt
  ```

  **Commit**: YES
  - Message: `fix(cli): fix JSONC stripping to preserve URLs, deduplicate`
  - Files: `src/cli.ts`, `src/cli/config.ts`, `src/cli/config.test.ts`
  - Pre-commit: `bun test`

- [x] 20. Extend universal search timeout in client.ts (TDD)

  **What to do**:
  - RED: Add test to `src/api/client.test.ts`: request to `/search/universal` uses `LONG_TIMEOUT_MS` (not default)
  - GREEN: Update `resolveTimeout` in `src/api/client.ts:251-261` — add `universal` to the regex pattern alongside `oracle|tracer`
  - REFACTOR: Ensure existing client tests pass

  **Must NOT do**: Do not change default timeout, retry logic, or any other client behavior

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 4
  - **Blocks**: None — **Blocked By**: Task 1

  **References**:
  - `src/api/client.ts:251-261` — `resolveTimeout` method with regex `/(^|\/)(oracle|tracer)(\/|$)/`
  - `src/api/client.ts:17` — `LONG_TIMEOUT_MS = 120_000`
  - Live test data: universal search times out at 30s default

  **Acceptance Criteria**:
  - [ ] `resolveTimeout` returns `LONG_TIMEOUT_MS` for paths containing `universal`
  - [ ] `bun test src/api/client.test.ts` passes

  **QA Scenarios**:

  ```
  Scenario: Universal search gets extended timeout
    Tool: Bash
    Steps:
      1. Run `bun test src/api/client.test.ts` — assert all pass
      2. Run `grep "universal" src/api/client.ts` — assert appears in resolveTimeout
    Expected Result: Tests pass, universal in timeout check
    Evidence: .sisyphus/evidence/task-20-timeout-fix.txt
  ```

  **Commit**: YES
  - Message: `fix(client): extend timeout for universal search mode`
  - Files: `src/api/client.ts`, `src/api/client.test.ts`
  - Pre-commit: `bun test src/api/client.test.ts`

- [x] 21. Research Nia advisor API contract

  **What to do**:
  - Use librarian agent to find Nia API documentation for the `/v2/advisor` endpoint
  - Alternatively, use `nia.nia_research` or check `https://docs.trynia.ai` for the advisor API spec
  - Determine what fields the API actually accepts (is it `codebase`? `repository`? `source_id`? or just `query`?)
  - Test calling `/v2/advisor` with just `{ query: "..." }` (no optional fields) to see if it succeeds
  - Document findings in `.sisyphus/evidence/task-21-advisor-api-research.md`

  **Must NOT do**:
  - Do not modify any source code — this is pure research
  - Do not guess the API contract

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 4
  - **Blocks**: Task 22 (advisor fix needs this research)
  - **Blocked By**: None

  **References**:
  - `src/tools/nia-advisor.ts` — current tool implementation (sends `codebase` field)
  - `tests/integration/real-api.test.ts:262-277` — existing test that asserts 422
  - `src/api/types.ts:300-314` — `AdvisorResult` type definition
  - API docs: `https://docs.trynia.ai/sdk/examples`

  **Acceptance Criteria**:
  - [ ] API contract documented in `.sisyphus/evidence/task-21-advisor-api-research.md`
  - [ ] Required fields identified
  - [ ] Optional fields and their types identified
  - [ ] Tested at least one successful call shape

  **QA Scenarios**:

  ```
  Scenario: API contract discovered
    Tool: Bash
    Steps:
      1. Check `.sisyphus/evidence/task-21-advisor-api-research.md` exists
      2. Verify it contains "required fields" section
      3. Verify it contains at least one successful request/response example
    Expected Result: Research document exists with concrete findings
    Evidence: .sisyphus/evidence/task-21-advisor-api-research.md
  ```

  **Commit**: NO (research only, no code changes)

- [x] 22. Fix nia_advisor request shape (BLOCKED by Task 21)

  **What to do**:
  - Based on Task 21 research, fix the request body in `src/tools/nia-advisor.ts` to match the actual API contract
  - Update the integration test in `tests/integration/real-api.test.ts` to assert SUCCESS (200) instead of the current 422 assertion
  - Update the Zod schema if field names change
  - Run integration test to confirm fix works against live API

  **Must NOT do**:
  - Do not guess — use Task 21 research findings
  - Do not change advisor response formatting

  **Recommended Agent Profile**:
  - **Category**: `quick` — **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO — **Sequential**: After Task 21
  - **Blocks**: None — **Blocked By**: Task 21 (research)

  **References**:
  - `.sisyphus/evidence/task-21-advisor-api-research.md` — API contract from research
  - `src/tools/nia-advisor.ts` — current implementation to fix
  - `tests/integration/real-api.test.ts:262-277` — test to flip from 422 to 200

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/nia-advisor.test.ts` passes (unit tests)
  - [ ] Integration test asserts success, not 422

  **QA Scenarios**:

  ```
  Scenario: Advisor API call succeeds
    Tool: Bash
    Steps:
      1. Run `bun test src/tools/nia-advisor.test.ts` — assert all pass
      2. Run `grep "422" tests/integration/real-api.test.ts` — assert 0 (no more 422 assertion)
    Expected Result: Unit tests pass, integration test asserts success
    Evidence: .sisyphus/evidence/task-22-advisor-fix.txt

  Scenario: Live API returns success (requires NIA_API_KEY)
    Tool: Bash
    Preconditions: NIA_API_KEY set in environment
    Steps:
      1. Run `bun test tests/integration/real-api.test.ts -t "advisor" --timeout 120000`
    Expected Result: Advisor integration test passes
    Evidence: .sisyphus/evidence/task-22-advisor-live.txt
  ```

  **Commit**: YES
  - Message: `fix(advisor): correct request shape for /v2/advisor endpoint`
  - Files: `src/tools/nia-advisor.ts`, `src/tools/nia-advisor.test.ts`, `tests/integration/real-api.test.ts`
  - Pre-commit: `bun test src/tools/nia-advisor.test.ts`

- [x] 23. Adopt CLI library + add CLI tests (TDD)

  **What to do**:
  - Research: evaluate `commander`, `yargs`, and `citty` for fit. Choose based on: ESM support, Bun compatibility, minimal size, TypeScript types. Document choice.
  - RED: Write tests for CLI behavior: (a) `--help` prints usage and exits 0, (b) `install --no-tui --api-key nk_test` calls install flow, (c) `uninstall --no-tui` calls uninstall flow, (d) unknown command prints error + exits 1, (e) `install --api-key` without value prints error
  - GREEN: Replace manual arg parsing in `src/cli.ts:292-317` with chosen library. Wire up `install` and `uninstall` commands with existing handler functions.
  - REFACTOR: Add the library to `dependencies` in package.json. Verify build still works.

  **Must NOT do**:
  - Do NOT add new CLI commands (only install, uninstall)
  - Do NOT add new flags beyond existing (--no-tui, --api-key)
  - Do NOT change install/uninstall business logic
  - Do NOT add TUI enhancements

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 4
  - **Blocks**: None — **Blocked By**: Task 19 (JSONC fix, since cli.ts is modified)

  **References**:
  - `src/cli.ts:292-317` — current manual arg parsing to replace
  - `src/cli.ts:106-196` — `install()` function (keep as-is)
  - `src/cli.ts:221-273` — `uninstall()` function (keep as-is)
  - `package.json:11-13` — bin entry for `nia-opencode`

  **Acceptance Criteria**:
  - [ ] CLI library in dependencies
  - [ ] `bun run dist/cli.js --help` exits 0, prints usage
  - [ ] `bun run dist/cli.js install --no-tui --api-key nk_test` invokes install
  - [ ] `bun run dist/cli.js unknown` exits 1
  - [ ] No manual `process.argv` parsing remains

  **QA Scenarios**:

  ```
  Scenario: CLI --help works
    Tool: Bash
    Steps:
      1. Run `bun run build` — assert exit 0
      2. Run `bun run dist/cli.js --help` — assert exit 0, output contains "install"
    Expected Result: Help text printed
    Evidence: .sisyphus/evidence/task-23-cli-help.txt

  Scenario: Unknown command shows error
    Tool: Bash
    Steps:
      1. Run `bun run dist/cli.js unknown-cmd 2>&1; echo "EXIT:$?"` — assert output contains error, exit 1
    Expected Result: Error message printed, exit code 1
    Evidence: .sisyphus/evidence/task-23-cli-unknown.txt
  ```

  **Commit**: YES
  - Message: `refactor(cli): adopt CLI library, replace manual arg parsing`
  - Files: `src/cli.ts`, `package.json`, `bun.lock`, CLI test file
  - Pre-commit: `bun run typecheck && bun test`

- [x] 24. Add integration tests: nia-read, nia-grep, nia-explore

  **What to do**:
  - Add live API tests to `tests/integration/real-api.test.ts` for nia-read, nia-grep, nia-explore
  - Each test: one happy-path call against a known indexed source + one error-path (invalid source)
  - Use `describe.skipIf(!process.env.NIA_API_KEY)` to skip when no key available
  - Follow existing test patterns in the file (use real NiaClient, log requests)

  **Must NOT do**:
  - Do not add more than 2 tests per tool (1 happy + 1 error)
  - Do not create test data that requires cleanup (use existing indexed sources)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES — **Parallel Group**: Wave 5 (with Tasks 25-27)
  - **Blocks**: F1-F4 — **Blocked By**: Tasks 9-11 (tool standardization)

  **References**:
  - `tests/integration/real-api.test.ts` — existing test file with patterns to follow
  - `src/tools/nia-read.ts`, `src/tools/nia-grep.ts`, `src/tools/nia-explore.ts` — tools being tested
  - `src/tools/source-resolver.ts` — shared source resolution used by all 3

  **Acceptance Criteria**:
  - [ ] 6 new tests (2 per tool) in real-api.test.ts
  - [ ] Tests pass with NIA_API_KEY set
  - [ ] Tests skip gracefully without NIA_API_KEY

  **QA Scenarios**:

  ```
  Scenario: Integration tests pass with API key
    Tool: Bash
    Preconditions: NIA_API_KEY set
    Steps:
      1. Run `bun test tests/integration/real-api.test.ts --timeout 120000`
    Expected Result: All tests pass (existing + new)
    Evidence: .sisyphus/evidence/task-24-integration-read-grep-explore.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add live API tests for nia-read, nia-grep, nia-explore`
  - Files: `tests/integration/real-api.test.ts`
  - Pre-commit: `bun test tests/integration/ --timeout 120000`

- [x] 25. Add integration tests: nia-context, nia-package-search

  **What to do**: Same pattern as Task 24 for nia-context and nia-package-search. 2 tests each (1 happy + 1 error).

  **Recommended Agent Profile**: **Category**: `unspecified-high` — **Skills**: []

  **Parallelization**: Wave 5 parallel. **Blocks**: F1-F4. **Blocked By**: Tasks 14-15.

  **References**:
  - `tests/integration/real-api.test.ts` — existing patterns
  - `src/tools/nia-context.ts`, `src/tools/nia-package-search.ts`

  **Acceptance Criteria**:
  - [ ] 4 new tests (2 per tool) pass with NIA_API_KEY

  **QA Scenarios**:

  ```
  Scenario: Context and package-search integration tests pass
    Tool: Bash
    Preconditions: NIA_API_KEY set
    Steps:
      1. Run `bun test tests/integration/real-api.test.ts -t "context|package" --timeout 120000`
    Expected Result: New tests pass
    Evidence: .sisyphus/evidence/task-25-integration-context-pkg.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add live API tests for nia-context, nia-package-search`
  - Files: `tests/integration/real-api.test.ts`
  - Pre-commit: `bun test tests/integration/ --timeout 120000`

- [x] 26. Add integration tests: nia-auto-subscribe, nia-tracer

  **What to do**: Same pattern as Task 24 for nia-auto-subscribe and nia-tracer. 2 tests each.

  **Recommended Agent Profile**: **Category**: `unspecified-high` — **Skills**: []

  **Parallelization**: Wave 5 parallel. **Blocks**: F1-F4. **Blocked By**: Tasks 16, 8.

  **References**:
  - `tests/integration/real-api.test.ts` — existing patterns
  - `src/tools/nia-auto-subscribe.ts`, `src/tools/nia-tracer.ts`

  **Acceptance Criteria**:
  - [ ] 4 new tests (2 per tool) pass with NIA_API_KEY

  **QA Scenarios**:

  ```
  Scenario: Auto-subscribe and tracer integration tests pass
    Tool: Bash
    Preconditions: NIA_API_KEY set
    Steps:
      1. Run `bun test tests/integration/real-api.test.ts -t "subscribe|tracer" --timeout 120000`
    Expected Result: New tests pass
    Evidence: .sisyphus/evidence/task-26-integration-subscribe-tracer.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add live API tests for nia-auto-subscribe, nia-tracer`
  - Files: `tests/integration/real-api.test.ts`
  - Pre-commit: `bun test tests/integration/ --timeout 120000`

- [x] 27. Add integration tests: nia-e2e

  **What to do**: Same pattern as Task 24 for nia-e2e. 2 tests (1 happy + 1 error). E2E involves encrypted sessions so test may need to be adapted to the available API surface.

  **Recommended Agent Profile**: **Category**: `unspecified-high` — **Skills**: []

  **Parallelization**: Wave 5 parallel. **Blocks**: F1-F4. **Blocked By**: Task 17.

  **References**:
  - `tests/integration/real-api.test.ts` — existing patterns
  - `src/tools/nia-e2e.ts`

  **Acceptance Criteria**:
  - [ ] 2 new tests pass with NIA_API_KEY (or documented skip if API doesn't support E2E in test)

  **QA Scenarios**:

  ```
  Scenario: E2E integration test
    Tool: Bash
    Preconditions: NIA_API_KEY set
    Steps:
      1. Run `bun test tests/integration/real-api.test.ts -t "e2e" --timeout 120000`
    Expected Result: E2E tests pass or skip gracefully
    Evidence: .sisyphus/evidence/task-27-integration-e2e.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add live API tests for nia-e2e`
  - Files: `tests/integration/real-api.test.ts`
  - Pre-commit: `bun test tests/integration/ --timeout 120000`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run typecheck` + `bun test`. Review all changed files for: `as any`, empty catches, console.log in prod, commented-out code, unused imports. Check DRY: `grep -rn "function formatUnexpectedError\|function isAbortError\|function isZodError\|function inlineCode" src/tools/` must return empty. Check error format compliance.
  Output: `Typecheck [PASS/FAIL] | Tests [N pass/N fail] | DRY [CLEAN/N copies] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (tools working together, CLI install/uninstall). Run integration tests with API key. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance: LRU eviction unchanged, smart-triggers unchanged, ops-tracker unchanged. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Guardrails [CLEAN/N violations] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Phase | Commit | Message | Files | Pre-commit |
|-------|--------|---------|-------|------------|
| 0 | 1 | `chore: pin dependency versions` | package.json | `bun run typecheck` |
| 0 | 2 | `chore: add .dockerignore, update .gitignore` | .dockerignore, .gitignore | — |
| 1 | 3 | `feat(format): parameterize formatUnexpectedError with tool prefix` | src/utils/format.ts, src/utils/format.test.ts | `bun test src/utils/format.test.ts` |
| 1 | 4 | `fix(config): make configValidated resettable for tests` | src/config.ts, src/config.test.ts | `bun test src/config.test.ts` |
| 2 | 5-8 | `refactor(tools): import shared format utilities in nia-{tool}` | per tool | `bun test src/tools/nia-{tool}.test.ts` |
| 3 | 9-17 | `feat(tools): standardize nia-{tool} with error handling and config checks` | per tool + test | `bun test src/tools/nia-{tool}.test.ts` |
| 4 | 18 | `fix(state): add TTLCache cleanup, bound NiaSessionState Maps` | src/state/cache.ts, src/state/session.ts + tests | `bun test src/state/` |
| 4 | 19 | `fix(cli): fix JSONC stripping, deduplicate in cli.ts` | src/cli.ts, src/cli/config.ts + tests | `bun test` |
| 4 | 20 | `fix(client): extend timeout for universal search` | src/api/client.ts, src/api/client.test.ts | `bun test src/api/client.test.ts` |
| 4 | 22 | `fix(advisor): correct request shape for /v2/advisor` | src/tools/nia-advisor.ts + test | `bun test src/tools/nia-advisor.test.ts` |
| 4 | 23 | `refactor(cli): adopt CLI library, replace manual arg parsing` | src/cli.ts, package.json + tests | `bun test` |
| 5 | 24-27 | `test(integration): add live API tests for nia-{tools}` | tests/integration/real-api.test.ts | `bun test tests/integration/ --timeout 120000` |

---

## Success Criteria

### Verification Commands
```bash
bun run typecheck                    # Expected: zero errors
bun test                             # Expected: all pass, <30s
bun test tests/integration/ --timeout 120000  # Expected: all pass (with NIA_API_KEY)
grep -rn "function formatUnexpectedError\|function isAbortError\|function isZodError\|function inlineCode" src/tools/  # Expected: empty
bun run dist/cli.js --help           # Expected: exits 0, prints help
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent (LRU/triggers/ops-tracker unchanged)
- [ ] All tests pass
- [ ] DRY: zero private copies of shared helpers in src/tools/
- [ ] Error format: all tools use canonical format
- [ ] Memory: NiaSessionState Maps are bounded
- [ ] CLI: library adopted, all commands work
- [ ] Integration: all tools have live API tests
