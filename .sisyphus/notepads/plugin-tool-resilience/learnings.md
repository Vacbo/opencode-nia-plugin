2026-03-21
- `src/services/connection-guardian.ts` needs more than the initial circuit-breaker surface: the current test suite also exercises `isNiaTool()`, `isConnectionError()`, `handleToolExecuteAfter()`, and `handleEvent()` alongside `onFailure()` and `dispose()`.
- The backoff behavior expected by the guardian matches the API client retry pattern: `Math.min(baseDelay * 2 ** failureCount, 30000)` with cooldown-driven `OPEN -> HALF_OPEN` probing.
- CRITICAL: The delay MUST precede the async `status()` call inside `onFailure`. The test's mutex/gate pattern requires the delay to be reached synchronously (no `await` before it).
- In CLOSED state, every `onFailure` call increments `failureCount` regardless of connect result. Only HALF_OPEN + successful connect resets. The tool failure already happened; reconnect is best-effort.
- `ConnectionGuardianConfig` (3-field narrow type) avoids importing the full `NiaConfig` and stays structurally compatible with the test's mock config.
