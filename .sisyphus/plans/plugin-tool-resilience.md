# Nia Plugin Tool Resilience — Auto-Retry on Failures & Connection Hardening

## TL;DR

> **Quick Summary**: Two-pronged fix for Nia plugin tool failures: (1) Fix NiaClient to retry network-level errors (ECONNREFUSED, DNS, fetch failures) which currently break out of the retry loop on first occurrence, and (2) add a reactive ConnectionGuardian that detects plugin tool failures via `tool.execute.after` and attempts best-effort reconnection via the OpenCode SDK — together these eliminate most "Failed to get tools" and timeout issues. All plugin tools benefit automatically, including E2E encryption tools.
> 
> **Deliverables**:
> - Updated `src/api/client.ts` — NiaClient retries transient network errors (not just HTTP 429/500/503)
> - New `src/services/connection-guardian.ts` — Best-effort reconnection guardian with circuit breaker
> - New `src/services/connection-guardian.test.ts` — Comprehensive tests
> - Updated `src/config.ts` — New config fields for guardian tuning
> - Updated `src/index.ts` — Guardian wired into plugin lifecycle
> - Updated `src/utils/format.ts` — Actionable error messages + credit exhaustion detection
> - Updated `README.md` — Configuration docs
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 → Task 3 → Task 5 → Task 7 → Task 8 → Task 9 → F1-F4

---

## Context

### Original Request
Nia plugin tools frequently fail with "Failed to get tools" or timeout errors. User wants automatic retry/reconnection and improved connection mechanisms to prevent these issues.

### Interview Summary
**Key Discussions**:
- **Scope**: Nia plugin tools only — not other MCP servers
- **Failure pattern**: Unknown whether startup or mid-session — design handles both
- **Strategy**: Reactive/error-driven (NOT polling) — detect errors when they happen, then retry/reconnect
- **Tool-level resilience**: YES — improve retry logic and add failure detection hooks

**Critical Clarification from User**:
- Nia tools are **plugin-provided tools**, NOT a separate MCP server
- OpenCode renders plugin tools identically to MCP tool calls in the UI
- "Failed to get tools" may refer to the plugin failing to load OR individual tool calls failing
- `client.mcp.connect()` is **best-effort** — may or may not work for plugin tools depending on OpenCode internals

**Research Findings**:
- **ROOT CAUSE IDENTIFIED**: `src/api/client.ts:271-284` — NiaClient's catch block returns immediately on network errors (`network_error: ...`) WITHOUT continuing the retry loop. Only HTTP status codes 429/500/503 trigger retries. Network-level failures (ECONNREFUSED, DNS, fetch errors) fail on first attempt.
- **SDK provides**: `client.mcp.status()`, `client.mcp.connect()` — best-effort for plugin tool reconnection (OpenCode internally represents plugin tools via MCP-like mechanism)
- **`tool.execute.after` cannot retry** — detects failures but can't re-execute. LLM retries naturally.
- **E2E encryption tools covered**: `nia_e2e` uses `NiaClient` (benefits from network retry fix) and `createToolErrorFormatter("e2e")` (benefits from actionable error messages). All 4 E2E actions (create_session, get_session, purge, sync) automatically gain resilience.
- **Test baseline**: Integration tests in `tests/integration/` fail due to exhausted tracer credits and real API dependencies — must scope verification to `bun test src/` (unit tests only)
- **Lint baseline**: 57 existing warnings in unrelated files — must scope lint checks to changed files only

### Metis Review
**Identified Gaps** (addressed):
- **Plugin vs MCP confusion**: Resolved — plugin tools are what fail, ConnectionGuardian is best-effort secondary fix
- **NiaClient network retry gap**: Primary fix — the catch block must `continue` on transient network errors
- **tool.execute.after cannot retry**: Documented as known limitation
- **Concurrent failures**: Added debounce/mutex
- **Cleanup on disposal**: `server.instance.disposed` cancels pending timers

### Momus Review (Round 1 — REJECTED, 3 blockers fixed)
1. **Task 2 RED phase typecheck conflict**: Fixed — tests define `ConnectionGuardian` interface types inline (no import of non-existent module during RED phase)
2. **`bun test` baseline red**: Fixed — all verification uses `bun test src/` (unit tests only, excludes failing integration tests)
3. **`bun run lint` has 57 existing warnings**: Fixed — lint scoped to changed files: `bun run lint src/services/connection-guardian.ts` or `bun run lint src/api/client.ts`

---

## Work Objectives

### Core Objective
Eliminate most Nia plugin tool failures — including E2E encryption tools — by (1) fixing NiaClient to retry transient network errors and (2) adding a reactive connection guardian that attempts best-effort reconnection when tool failures are detected.

### Concrete Deliverables
- Updated `src/api/client.ts` — network error retry
- Updated `src/api/client.test.ts` — new tests for network retry
- New `src/services/connection-guardian.ts` — ConnectionGuardian class
- New `src/services/connection-guardian.test.ts` — full test coverage
- Updated `src/config.ts` — new config fields
- Updated `src/config.test.ts` — new config tests
- Updated `src/index.ts` — guardian wired into lifecycle
- Updated `README.md` — config documentation

### Definition of Done
- [x] `bun test src/api/client.test.ts` → all pass, 0 failures
- [x] `bun test src/services/connection-guardian.test.ts` → all pass, 0 failures
- [x] `bun test src/` → all unit tests pass (no regression)
- [x] `bun run typecheck` → 0 errors

### Must Have
- NiaClient retries transient network errors (ECONNREFUSED, ECONNRESET, DNS, fetch failures) with exponential backoff
- ConnectionGuardian with circuit breaker (CLOSED → OPEN → HALF_OPEN → CLOSED)
- Debounced reconnection — multiple simultaneous failures = ONE reconnect attempt
- Configurable guardian settings via env vars
- `tool.execute.after` hook to detect failures and trigger guardian
- Cleanup on `server.instance.disposed`
- All debug output via existing `log()` function
- Tests with injectable dependencies — no real timers

### Must NOT Have (Guardrails)
- **NO polling/intervals** — reactive only, triggered by errors
- **NO external dependencies** — circuit breaker implemented inline
- **NO reconnection of other MCP servers** — Nia tools only
- **NO handling of `needs_auth` status** — auth problems are a different feature
- **NO user-facing notifications** — log only for v1
- **NO transparent retry of failed tool calls in hooks** — architecturally impossible with hook system; document limitation

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.
> **SCOPED TESTING**: Use `bun test src/` (unit tests only). Integration tests in `tests/integration/` fail due to exhausted API credits — unrelated to this work.
> **SCOPED LINTING**: Lint only changed files. 57 existing warnings in unrelated files are out of scope.

### Test Decision
- **Infrastructure exists**: YES (`bun:test`)
- **Automated tests**: TDD (tests before implementation)
- **Each task follows**: RED (failing test) → GREEN (minimal impl) → REFACTOR

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 3 parallel foundation tasks):
├── Task 1: Config additions (env vars, types)                        [quick]
├── Task 2: Tests for NiaClient network error retry                   [unspecified-high]
├── Task 3: Tests for ConnectionGuardian circuit breaker (types inline)      [unspecified-high]

Wave 2 (After Wave 1 — 4 parallel core tasks):
├── Task 4: Implement NiaClient network error retry                   [deep]
├── Task 5: Implement ConnectionGuardian with circuit breaker                [deep]
├── Task 6: Actionable error messages + credit detection              [unspecified-high]
├── Task 7: Tests for tool failure detection + event handling          [unspecified-high]

Wave 3 (After Wave 2 — wiring + hardening + docs):
├── Task 8: Wire guardian into plugin lifecycle + helpers              [unspecified-high]
├── Task 9: Edge case hardening + tests                               [unspecified-high]
├── Task 10: README documentation                                     [writing]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── F1: Plan compliance audit                                         [oracle]
├── F2: Code quality review                                           [unspecified-high]
├── F3: Real QA                                                       [unspecified-high]
└── F4: Scope fidelity check                                          [deep]
-> Present results -> Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 3, 5, 8, 9, 10 | 1 |
| 2 | — | 4 | 1 |
| 3 | 1 | 5 | 1 |
| 4 | 2 | 8 | 2 |
| 5 | 1, 3 | 7, 8, 9 | 2 |
| 6 | — | 8 | 2 |
| 7 | 5 | 8 | 2 |
| 8 | 4, 5, 6, 7 | 9 | 3 |
| 9 | 5, 8 | 10 | 3 |
| 10 | 1, 9 | — | 3 |
| F1-F4 | ALL | — | FINAL |

### Agent Dispatch Summary

- **Wave 1**: **3 tasks** — T1 `quick`, T2 `unspecified-high`, T3 `unspecified-high`
- **Wave 2**: **4 tasks** — T4 `deep`, T5 `deep`, T6 `unspecified-high`, T7 `unspecified-high`
- **Wave 3**: **3 tasks** — T8 `unspecified-high`, T9 `unspecified-high`, T10 `writing`
- **Wave FINAL**: **4 tasks** — F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. Add Guardian Config Fields

  **What to do**:
  - Add 3 new fields to `NiaConfig` in `src/config.ts`: `mcpServerName` (string, default `"nia"`), `mcpMaxRetries` (int, default `5`), `mcpReconnectBaseDelay` (int ms, default `100`)
  - Add env var parsing: `NIA_MCP_SERVER_NAME`, `NIA_MCP_MAX_RETRIES`, `NIA_MCP_RECONNECT_DELAY`
  - Add validation via `validatePositiveBounded()` for numeric fields (max 20 for retries, max 60000 for delay)
  - Add tests in `src/config.test.ts` for defaults, parsing, and validation

  **Must NOT do**: Modify existing config fields or defaults

  **Recommended Agent Profile**: `quick` | Skills: []
  **Parallelization**: Wave 1, parallel with Tasks 2+3 | Blocks: 3,5,8,9,10 | Blocked By: None

  **References**:
  - `src/config.ts:35-54` — `DEFAULTS` constant pattern
  - `src/config.ts:158-217` — `loadConfig()` env var parsing pattern
  - `src/config.ts:136-150` — `validatePositiveBounded()` reusable validator

  **Acceptance Criteria**:
  - [x] `NiaConfig` has 3 new fields with correct types
  - [x] `bun test src/config.test.ts` → PASS
  - [x] `bun run typecheck` → 0 errors

  **QA Scenarios:**
  ```
  Scenario: Defaults applied
    Tool: Bash
    Steps: bun test src/config.test.ts
    Expected: Tests pass — mcpServerName="nia", mcpMaxRetries=5, mcpReconnectBaseDelay=100
    Evidence: .sisyphus/evidence/task-1-config.txt

  Scenario: Validation warns on out-of-range
    Tool: Bash
    Steps: bun test src/config.test.ts (tests for mcpMaxRetries > 20)
    Expected: Validation warning produced
    Evidence: .sisyphus/evidence/task-1-validation.txt
  ```

  **Commit**: `feat(config): add connection guardian configuration fields`
  Files: `src/config.ts`, `src/config.test.ts` | Pre-commit: `bun test src/config.test.ts`

- [x] 2. Write Tests for NiaClient Network Error Retry

  **What to do**:
  - Add new test section to `src/api/client.test.ts`:
    - **Network error retry**: `fetch` throws `TypeError("fetch failed")` → retries up to MAX_RETRIES with backoff, then returns `network_error`
    - **ECONNREFUSED retry**: `fetch` throws `Error("ECONNREFUSED")` → retries, not immediate failure
    - **DNS error retry**: `fetch` throws `Error("getaddrinfo ENOTFOUND")` → retries
    - **Succeeds after transient failure**: `fetch` throws once, succeeds on retry → returns success response
    - **Abort during network retry**: signal aborted during backoff → returns `abort_error` immediately
    - **Timeout NOT retried**: timeout error still returns immediately (no change to timeout behavior)
    - **Non-transient errors NOT retried**: `TypeError("invalid URL")` → NOT retried (only transient network errors)
  - Follow existing test patterns: `createFetchMock()` step-based mocking, `describe`/`it` blocks
  - Tests should be RED (current NiaClient doesn't retry network errors)

  **Must NOT do**: Modify NiaClient implementation yet (TDD RED), delete existing tests

  **Recommended Agent Profile**: `unspecified-high` | Skills: []
  **Parallelization**: Wave 1, parallel with Tasks 1+3 | Blocks: 4 | Blocked By: None

  **References**:
  - `src/api/client.test.ts:1-42` — Test setup: `createFetchMock()`, `jsonResponse()` helpers
  - `src/api/client.test.ts:274-295` — Rate limit retry test pattern (429 with Retry-After headers)
  - `src/api/client.ts:271-284` — The catch block that currently returns immediately on network error — THIS IS WHAT WE'RE FIXING

  **WHY Each Reference Matters**:
  - `client.test.ts:274-295` shows exactly how retry behavior is tested (step-based mock with multiple responses)
  - `client.ts:271-284` is the code path being tested — network errors go to catch, return `network_error: ...` without retry

  **Acceptance Criteria**:
  - [x] >= 7 new test cases added to `src/api/client.test.ts`
  - [x] Tests cover: retry on fetch failure, ECONNREFUSED, DNS, success-after-retry, abort, timeout-no-retry, non-transient-no-retry
  - [x] Tests currently FAIL (RED phase — NiaClient doesn't retry network errors)
  - [x] `bun run typecheck` → 0 errors

  **QA Scenarios:**
  ```
  Scenario: Tests exist and are RED
    Tool: Bash
    Steps: bun test src/api/client.test.ts
    Expected: New retry tests FAIL (existing tests still pass)
    Evidence: .sisyphus/evidence/task-2-network-retry-red.txt
  ```

  **Commit**: `test(client): add network error retry test cases`
  Files: `src/api/client.test.ts` | Pre-commit: `bun run typecheck`

- [x] 3. Write Tests for ConnectionGuardian Circuit Breaker

  **What to do**:
  - Create `src/services/connection-guardian.test.ts` with tests for:
    - Circuit breaker states: starts CLOSED, transitions to OPEN after N failures, HALF_OPEN after cooldown, CLOSED on success
    - Exponential backoff values: 100, 200, 400, 800, 1600ms for baseDelay=100
    - `onFailure()` calls `client.mcp.status()` → checks for `"failed"` → calls `client.mcp.connect()`
    - Successful recovery resets failure count
    - Circuit open: skips reconnection, logs
    - Half-open: tries exactly ONE reconnection
    - Debounce: 5 concurrent `onFailure()` → `connect()` called exactly ONCE
    - `dispose()` resets state
  - **Define `ConnectionGuardian` types INLINE in the test file** (interface + constructor shape) — avoids typecheck failure when implementation doesn't exist yet. These inline types serve as the contract.
  - Use injectable `now: () => number` and `delay: (ms: number) => Promise<void>` — no real timers

  **Must NOT do**: Implement ConnectionGuardian yet (TDD RED), import from `@opencode-ai/sdk`

  **Recommended Agent Profile**: `unspecified-high` | Skills: []
  **Parallelization**: Wave 1, parallel with Tasks 1+2 | Blocks: 5 | Blocked By: Task 1 (needs NiaConfig types)

  **References**:
  - `src/api/client.test.ts:1-50` — Test setup patterns, mock builder
  - `src/api/client.ts:27-29` — `INITIAL_BACKOFF_MS`, `MAX_RETRIES` constants naming pattern
  - `src/api/client.ts:336-353` — Exponential backoff formula: `baseDelay * 2 ** attempt`
  - `src/state/ops-tracker.ts:26-42` — Class with injectable deps pattern

  **Acceptance Criteria**:
  - [x] `src/services/connection-guardian.test.ts` exists with >= 8 test cases
  - [x] Types defined inline — `bun run typecheck` → 0 errors
  - [x] Tests fail with "cannot find module" or similar (RED — no implementation)

  **QA Scenarios:**
  ```
  Scenario: Tests exist, type-check, and are RED
    Tool: Bash
    Steps: bun run typecheck && bun test src/services/connection-guardian.test.ts
    Expected: Typecheck passes, tests fail (module not found)
    Evidence: .sisyphus/evidence/task-3-guardian-red.txt
  ```

  **Commit**: `test(plugin): add circuit breaker and reconnection unit tests`
  Files: `src/services/connection-guardian.test.ts` | Pre-commit: `bun run typecheck`

- [x] 4. Implement NiaClient Network Error Retry

  **What to do**:
  - Modify the catch block in `src/api/client.ts:271-284` (inside the `request()` method retry loop):
    - **Before**: catch block returns `network_error: ...` immediately, breaking the retry loop
    - **After**: check if error is transient network error → if yes AND attempt < MAX_RETRIES → `await this.sleep(backoff)` → `continue` (retry)
    - **Transient network errors** (retry): `TypeError` with message containing "fetch failed", "network", "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "EPIPE", "ETIMEDOUT", "getaddrinfo"
    - **Non-transient errors** (don't retry): `TypeError("invalid URL")`, other non-network errors
    - Add a private method `isTransientNetworkError(error: unknown): boolean` to classify errors
    - Keep existing abort/timeout handling unchanged — those still return immediately
    - After all retries exhausted on network errors, return `network_error: request retries exhausted`

  **Must NOT do**: Change HTTP status retry logic, change timeout handling, add external deps

  **Recommended Agent Profile**: `deep` | Skills: []
  **Parallelization**: Wave 2 | Blocks: 8 | Blocked By: Task 2

  **References**:
  - `src/api/client.ts:231-293` — Full `request()` method with retry loop
  - `src/api/client.ts:271-284` — THE catch block to modify (currently returns immediately)
  - `src/api/client.ts:256-268` — HTTP retry pattern to follow (check retryable → sleep → continue)
  - `src/api/client.ts:336-353` — `resolveRetryDelay()` for backoff calculation
  - `src/api/client.ts:431-435` — `isAbortError()` — follow this pattern for `isTransientNetworkError()`

  **WHY Each Reference Matters**:
  - `client.ts:256-268` shows the EXACT retry pattern to replicate: check condition → backoff → continue
  - `client.ts:271-284` is the code to change — currently the catch returns, breaking the loop
  - `isAbortError()` is the pattern to follow for the new `isTransientNetworkError()` classifier

  **Acceptance Criteria**:
  - [x] `isTransientNetworkError()` private method exists on NiaClient
  - [x] Network errors (fetch failed, ECONNREFUSED, DNS) trigger retry with backoff
  - [x] Non-transient errors still return immediately
  - [x] Abort/timeout behavior unchanged
  - [x] `bun test src/api/client.test.ts` → ALL tests pass (old + new from Task 2)
  - [x] `bun run typecheck` → 0 errors

  **QA Scenarios:**
  ```
  Scenario: All client tests pass including new network retry tests (GREEN)
    Tool: Bash
    Steps: bun test src/api/client.test.ts
    Expected: ALL tests pass — including Task 2 network retry tests now GREEN
    Evidence: .sisyphus/evidence/task-4-client-green.txt

  Scenario: Existing behavior unchanged
    Tool: Bash
    Steps: bun test src/api/client.test.ts (filter for existing test names)
    Expected: No regressions — HTTP retry, timeout, abort all work as before
    Evidence: .sisyphus/evidence/task-4-no-regression.txt
  ```

  **Commit**: `fix(client): retry transient network errors with exponential backoff`
  Files: `src/api/client.ts` | Pre-commit: `bun test src/api/client.test.ts`

- [x] 5. Implement ConnectionGuardian with Circuit Breaker

  **What to do**:
  - Create `src/services/connection-guardian.ts` implementing `ConnectionGuardian` class:
    - Constructor: `{ config: NiaConfig, mcpClient: ReconnectClient, now?, delay? }`
    - `ReconnectClient` interface: `{ status(): Promise<Record<string, { status: string; error?: string }>>, connect(opts: { name: string }): Promise<{ data: boolean }> }`
    - States: `CLOSED | OPEN | HALF_OPEN` (string union)
    - `onFailure(toolName: string): Promise<void>` — main entry: check circuit → mutex → status → connect → update state
    - `dispose(): void` — reset all state, set disposed flag
    - Backoff: `Math.min(config.mcpReconnectBaseDelay * 2 ** failureCount, 30000)`
    - Cooldown: `CIRCUIT_COOLDOWN_MS = 30_000` hardcoded
    - Mutex: boolean `reconnecting` flag
    - All logging via `log()` from `src/services/logger.ts`
  - Export: `ConnectionGuardian`, `ReconnectClient`, `CircuitState`

  **Must NOT do**: Add polling/setInterval, use external deps, import from `@opencode-ai/sdk`, handle `needs_auth`

  **Recommended Agent Profile**: `deep` | Skills: []
  **Parallelization**: Wave 2, parallel with Tasks 4+6 | Blocks: 7,8,9 | Blocked By: Tasks 1, 3

  **References**:
  - `src/api/client.ts:336-353` — Backoff formula pattern
  - `src/api/client.ts:411-429` — Cancellable sleep pattern
  - `src/state/ops-tracker.ts:26-42` — Class with injectable deps + options object
  - `src/services/logger.ts:3-13` — `log()` function for debug output

  **Acceptance Criteria**:
  - [x] `src/services/connection-guardian.ts` exports ConnectionGuardian, ReconnectClient, CircuitState
  - [x] `bun test src/services/connection-guardian.test.ts` → ALL tests pass (GREEN)
  - [x] Concurrent `onFailure()` calls → exactly ONE `connect()` call
  - [x] `bun run typecheck` → 0 errors

  **QA Scenarios:**
  ```
  Scenario: Guardian tests GREEN
    Tool: Bash
    Steps: bun test src/services/connection-guardian.test.ts
    Expected: All circuit breaker tests pass
    Evidence: .sisyphus/evidence/task-5-guardian-green.txt
  ```

  **Commit**: `feat(plugin): implement connection guardian with circuit breaker`
  Files: `src/services/connection-guardian.ts` | Pre-commit: `bun test src/services/connection-guardian.test.ts`

- [x] 6. Actionable Error Messages + Credit Exhaustion Detection

  **What to do**:
  - Add error classification to `src/utils/format.ts`:
    - New function `classifyApiError(errorString: string): { category: string; actionableMessage: string } | null`
    - **Credit/plan exhaustion** (403 "forbidden" with "plan required", "credits", "quota", "limit exceeded"): Return `{ category: "credits_exhausted", actionableMessage: "⚠️ Your Nia credits may be exhausted or your plan doesn't include this feature. Check your usage at https://app.trynia.ai" }`
    - **Rate limited** (429): Return `{ category: "rate_limited", actionableMessage: "Nia API rate limit hit. The request will be retried automatically." }`
    - **Auth error** (401): Return `{ category: "auth_error", actionableMessage: "Nia API key is invalid or expired. Update your key at ~/.config/nia/api_key" }`
    - **Network error** (contains "network_error", "ECONNREFUSED", "timeout_error"): Return `{ category: "network_error", actionableMessage: "Unable to reach Nia API. Check your network connection." }`
    - Return `null` for unrecognized errors (no enhancement)
  - Update `formatUnexpectedError()` in `src/utils/format.ts` to append actionable message when `classifyApiError()` matches
  - Update `createToolErrorFormatter()` — the returned formatter should also call `classifyApiError()` on the error string and append the actionable message
  - Add tests in `src/utils/format.test.ts`:
    - Test `classifyApiError()` with various error strings
    - Test that `formatUnexpectedError()` appends actionable message for credit errors
    - Test that unrecognized errors are returned unchanged

  **Must NOT do**: Modify `src/api/client.ts` error format, add external deps, change error string structure (append only)

  **Recommended Agent Profile**: `unspecified-high` | Skills: []
  **Parallelization**: Wave 2, parallel with Tasks 4+5 | Blocks: 8 | Blocked By: None

  **References**:
  - `src/utils/format.ts:1-32` — Existing `formatUnexpectedError()` and `createToolErrorFormatter()`
  - `src/utils/format.test.ts` — Existing format tests to extend
  - `src/api/client.ts:30-38` — ERROR_CODES map showing error string format: `code [status]: message`
  - `src/api/client.ts:389-408` — `formatApiError()` showing the exact error string shape: `"forbidden [403]: plan required"`
  - `src/tools/nia-tracer.test.ts:98` — Test showing `"forbidden [403]: plan required"` error pattern
  - `src/tools/nia-advisor.test.ts:62` — Test showing various API error patterns

  **WHY Each Reference Matters**:
  - `client.ts:389-408` shows the exact error string format tools receive: `"code [status]: message"` — classifier must parse this
  - `nia-tracer.test.ts:98` proves the API returns `"forbidden [403]: plan required"` for credit/plan issues — this is the pattern to detect
  - `format.ts` is where the classifier lives — it's the centralized error formatting module

  **Acceptance Criteria**:
  - [x] `classifyApiError()` exported from `src/utils/format.ts`
  - [x] Detects credit exhaustion from `"forbidden [403]: plan required"` and similar patterns
  - [x] Detects rate limiting from `"rate_limited [429]: ..."`
  - [x] Detects auth errors from `"unauthorized [401]: ..."`
  - [x] Detects network errors from `"network_error: ..."`
  - [x] Returns `null` for unrecognized errors
  - [x] `bun test src/utils/format.test.ts` → PASS
  - [x] `bun run typecheck` → 0 errors

  **QA Scenarios:**
  ```
  Scenario: Credit exhaustion detected and actionable message returned
    Tool: Bash
    Steps: bun test src/utils/format.test.ts
    Expected: Test passes — classifyApiError("forbidden [403]: plan required") returns category "credits_exhausted" with URL to app.trynia.ai
    Evidence: .sisyphus/evidence/task-6-credit-detection.txt

  Scenario: Unrecognized errors pass through unchanged
    Tool: Bash
    Steps: bun test src/utils/format.test.ts
    Expected: classifyApiError("not_found [404]: ...") returns null
    Evidence: .sisyphus/evidence/task-6-passthrough.txt
  ```

  **Commit**: `feat(format): add actionable error messages with credit exhaustion detection`
  Files: `src/utils/format.ts`, `src/utils/format.test.ts` | Pre-commit: `bun test src/utils/format.test.ts`

- [x] 7. Write Tests for Tool Failure Detection & Event Handling

  **What to do**:
  - Extend `src/services/connection-guardian.test.ts` with:
    - `isNiaTool(toolName, serverName)`: `"nia_search"` → true, `"nia.search"` → true, `"browser.click"` → false
    - `isConnectionError(output)`: `"Failed to get tools"` → true, `"timeout_error"` → true, `"network_error"` → true, `"not_found [404]"` → false, `"forbidden [403]: plan required"` → false (credit errors should NOT trigger reconnection)
    - `handleToolExecuteAfter(input, output)`: filters by tool name, detects error, calls `onFailure()`
    - `handleEvent({ type: "server.instance.disposed" })` → calls `dispose()`
    - `handleEvent({ type: "session.deleted" })` → does NOT call dispose

  **Must NOT do**: Modify existing tests, implement helpers yet

  **Recommended Agent Profile**: `unspecified-high` | Skills: []
  **Parallelization**: Wave 2, parallel with Task 4 | Blocks: 8 | Blocked By: Task 5

  **References**:
  - `src/index.ts:85-89` — `tool.execute.after` hook signature
  - `src/index.ts:75-83` — `event` hook signature
  - `src/utils/format.ts` — Error string patterns to match

  **Acceptance Criteria**:
  - [x] Tests for `isNiaTool()`, `isConnectionError()`, `handleToolExecuteAfter()`, `handleEvent()` added
  - [x] Credit errors (`"forbidden [403]: plan required"`) are NOT classified as connection errors
  - [x] `bun run typecheck` → 0 errors

  **QA Scenarios:**
  ```
  Scenario: Detection tests added
    Tool: Bash
    Steps: bun test src/services/connection-guardian.test.ts
    Expected: New tests run (some RED for unimplemented helpers)
    Evidence: .sisyphus/evidence/task-7-detection-tests.txt
  ```

  **Commit**: `test(plugin): add tool failure detection and event handling tests`
  Files: `src/services/connection-guardian.test.ts` | Pre-commit: `bun run typecheck`

- [x] 8. Wire Guardian into Plugin Lifecycle + Implement Helpers

  **What to do**:
  - Add `isNiaTool()` and `isConnectionError()` to `src/services/connection-guardian.ts`:
    - `isNiaTool(toolName, serverName)`: `toolName.startsWith(serverName + ".") || toolName.startsWith(serverName + "_")`
    - `isConnectionError(output)`: matches "Failed to get tools", "timeout_error", "network_error", "ECONNREFUSED", "ECONNRESET", "stream_error" — but NOT "forbidden", "unauthorized", "rate_limited", "not_found" (those are API errors, not connection errors)
  - Add `handleToolExecuteAfter()` and `handleEvent()` methods to ConnectionGuardian
  - Update `src/index.ts`:
    - Import ConnectionGuardian
    - Initialize after `setOpencodeClient(client)`: `const guardian = new ConnectionGuardian({ config, mcpClient: client.mcp })`
    - Extend `tool.execute.after` to call `guardian.handleToolExecuteAfter(input)` alongside opsTracker
    - Extend `event` handler to call `guardian.handleEvent(event)`
    - Only initialize when `configured === true`

  **Must NOT do**: Remove/modify existing opsTracker or event logic, block tool execution (fire-and-forget)

  **Recommended Agent Profile**: `unspecified-high` | Skills: []
  **Parallelization**: Wave 3 | Blocks: 9 | Blocked By: Tasks 4, 5, 6, 7

  **References**:
  - `src/index.ts:58-163` — Plugin initialization flow
  - `src/index.ts:85-89` — Existing `tool.execute.after` (extend, don't replace)
  - `src/index.ts:75-83` — Existing `event` handler (extend)
  - `src/index.ts:70-72` — Client creation pattern to follow for guardian

  **Acceptance Criteria**:
  - [ ] Guardian initialized in `src/index.ts` when configured
  - [ ] `tool.execute.after` calls guardian alongside opsTracker
  - [ ] `event` handler calls guardian on `server.instance.disposed`
  - [ ] `isNiaTool()` and `isConnectionError()` exported from connection-guardian.ts
  - [ ] E2E tool (`nia_e2e`) benefits from both fixes: uses NiaClient (network retry) + createToolErrorFormatter (actionable errors)
  - [ ] `bun test src/` → ALL unit tests pass (including E2E tool tests in `src/tools/nia-e2e.test.ts`)
  - [ ] `bun run typecheck` → 0 errors

  **QA Scenarios:**
  ```
  Scenario: Full unit test suite green (including E2E tools)
    Tool: Bash
    Steps: bun test src/
    Expected: All unit tests pass — guardian, client, config, format, E2E, all existing tools
    Evidence: .sisyphus/evidence/task-8-full-suite.txt

  Scenario: E2E tool tests still pass (no regression)
    Tool: Bash
    Steps: bun test src/tools/nia-e2e.test.ts
    Expected: All E2E tool tests pass — create_session, get_session, purge, sync, error handling
    Evidence: .sisyphus/evidence/task-8-e2e-no-regression.txt
  ```

  **Commit**: `feat(plugin): wire connection guardian into plugin lifecycle`
  Files: `src/index.ts`, `src/services/connection-guardian.ts` | Pre-commit: `bun test src/`

- [x] 9. Edge Case Hardening + Tests

  **What to do**:
  - Add edge case tests to `src/services/connection-guardian.test.ts`:
    - 10 concurrent `onFailure()` → `connect()` called exactly 1 time
    - `status()` returns `"connected"` → skip reconnection, don't count as failure
    - `status()` returns `"needs_auth"` → skip, log warning, don't count as failure
    - `connect()` returns `{ data: false }` → treat as failure
    - `connect()` throws → catch, log, treat as failure, don't crash
    - `status()` throws → catch, log, treat as failure, don't crash
    - `dispose()` during reconnection → state fully reset
  - Implement handling in `src/services/connection-guardian.ts`:
    - `disposed` flag — all methods check before executing
    - Status shortcutting (connected → skip, needs_auth → warn)
    - Wrap connect/status in try-catch

  **Must NOT do**: Add polling/timers, change circuit breaker core logic

  **Recommended Agent Profile**: `unspecified-high` | Skills: []
  **Parallelization**: Wave 3, after Task 8 | Blocks: 10 | Blocked By: Tasks 5, 8

  **References**:
  - `src/services/connection-guardian.ts` — Existing implementation to harden
  - `src/api/client.ts:271-285` — Error handling pattern: catch → classify → return/log

  **Acceptance Criteria**:
  - [ ] >= 7 edge case tests added and passing
  - [ ] Concurrency: 10 concurrent failures → exactly 1 connect() call
  - [ ] dispose() fully resets state
  - [ ] connect/status errors caught, logged, don't crash
  - [ ] `bun test src/` → ALL pass
  - [ ] `bun run typecheck` → 0 errors

  **QA Scenarios:**
  ```
  Scenario: Edge cases handled
    Tool: Bash
    Steps: bun test src/services/connection-guardian.test.ts
    Expected: All tests pass including edge cases
    Evidence: .sisyphus/evidence/task-9-edge-cases.txt
  ```

  **Commit**: `test(plugin): add edge case tests and harden error handling`
  Files: `src/services/connection-guardian.test.ts`, `src/services/connection-guardian.ts` | Pre-commit: `bun test src/`

- [x] 10. README Documentation

  **What to do**:
  - Add "Plugin Connection Resilience" section to README.md under Legacy Configuration:
    - Document env vars: `NIA_MCP_SERVER_NAME`, `NIA_MCP_MAX_RETRIES`, `NIA_MCP_RECONNECT_DELAY`
    - Explain how it works: network retry for all plugin tools (including E2E), circuit breaker, best-effort reconnection
    - Document actionable error messages: credit exhaustion, rate limiting, auth errors now show clear guidance
    - Document E2E tool coverage: all E2E encryption tools automatically benefit from improved resilience
    - Document limitation: failed call returns error, agent retries naturally

  **Must NOT do**: Modify existing README content

  **Recommended Agent Profile**: `writing` | Skills: []
  **Parallelization**: Wave 3, parallel with Tasks 8+9 | Blocks: None | Blocked By: Tasks 1, 9

  **References**:
  - `README.md:108-180` — Existing config/debugging sections for format/tone

  **Acceptance Criteria**:
  - [ ] README has "Plugin Connection Resilience" section
  - [ ] All 3 env vars documented
  - [ ] Actionable error messages documented
  - [ ] No existing content modified

  **QA Scenarios:**
  ```
  Scenario: README complete
    Tool: Bash (grep)
    Steps: grep "Plugin Connection Resilience" README.md && grep "NIA_MCP_SERVER_NAME" README.md && grep "credit" README.md && grep "E2E" README.md
    Expected: All greps match
    Evidence: .sisyphus/evidence/task-10-readme.txt
  ```

  **Commit**: `docs: add plugin connection resilience and error messages to README`
  Files: `README.md`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run typecheck` + `bun test src/`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real QA** — `unspecified-high`
  Start from clean state. Run `bun test src/` and verify all unit tests pass. Verify ConnectionGuardian is wired into plugin lifecycle correctly by reading `src/index.ts`. Check that NiaClient retry logic covers network errors. Verify circuit breaker state transitions in test output. Check README contains new env vars.
  Output: `Tests [N/N pass] | Config [complete/incomplete] | Wiring [correct/issues] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Commit | Message | Files | Pre-commit |
|--------|---------|-------|------------|
| 1 | `feat(config): add connection guardian configuration fields` | `src/config.ts`, `src/config.test.ts` | `bun test src/config.test.ts` |
| 2 | `fix(client): retry transient network errors with exponential backoff` | `src/api/client.ts`, `src/api/client.test.ts` | `bun test src/api/client.test.ts` |
| 3 | `feat(format): add actionable error messages with credit exhaustion detection` | `src/utils/format.ts`, `src/utils/format.test.ts` | `bun test src/utils/format.test.ts` |
| 4 | `feat(plugin): implement connection guardian with circuit breaker` | `src/services/connection-guardian.ts`, `src/services/connection-guardian.test.ts` | `bun test src/services/connection-guardian.test.ts` |
| 5 | `feat(plugin): wire connection guardian into plugin lifecycle` | `src/index.ts`, `src/services/connection-guardian.ts` | `bun test src/` |
| 6 | `test(plugin): add edge case and concurrency tests for connection guardian` | `src/services/connection-guardian.test.ts`, `src/services/connection-guardian.ts` | `bun test src/` |
| 7 | `docs: add plugin connection resilience and error messages to README` | `README.md` | — |

---

## Success Criteria

### Verification Commands
```bash
bun test src/                                   # Expected: all unit tests pass, 0 failures
bun test src/api/client.test.ts                  # Expected: client tests pass incl. network retry
bun test src/services/connection-guardian.test.ts        # Expected: guardian tests pass
bun run typecheck                                # Expected: 0 errors
```

### Final Checklist
- [x] NiaClient retries transient network errors (ECONNREFUSED, ECONNRESET, DNS, fetch) up to MAX_RETRIES
- [x] ConnectionGuardian implements circuit breaker (CLOSED → OPEN → HALF_OPEN → CLOSED)
- [x] `tool.execute.after` detects Nia plugin tool failures and triggers guardian
- [x] Concurrent failures trigger exactly ONE reconnection
- [x] `server.instance.disposed` cancels pending timers and resets state
- [x] Exponential backoff follows `min(baseDelay * 2^attempt, 30000ms)`
- [x] No polling/intervals in new code
- [x] Actionable error messages for credit exhaustion, rate limiting, auth errors
- [x] E2E encryption tools (nia_e2e) benefit from both network retry and actionable errors — no regression
- [x] All existing unit tests still pass
- [x] README documents new env vars and E2E coverage
