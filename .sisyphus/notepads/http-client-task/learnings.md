- 2026-03-18: `src/api/client.ts` uses constructor-time `process.env.NIA_API_URL` fallback so tests and runtime can override the base URL without recompiling.
- 2026-03-18: Reusing `Response` instances in mock fetches can consume bodies across retries; cloning responses in tests keeps retry assertions stable.
- 2026-03-18: New Nia tool modules can stay testable by accepting a `NiaClient` instance or lazy resolver, which lets the plugin wire tools from env config without blocking unit tests.
- 2026-03-18: `context.ask()` in the installed `@opencode-ai/plugin` typings is permission-metadata based, so destructive tool flows should treat a thrown/rejected ask as cancellation and avoid calling DELETE.
- 2026-03-18: Search tool tests are simplest when the tool factory accepts an injected `post()` client and config override, which keeps abort/error/truncation behavior isolated from live API state.
- 2026-03-18: `src/tools/*` tool factories follow a multi-action pattern: validate action-specific args early, return client error strings verbatim, and rely on `context.ask()` for destructive flows.

- 2026-03-18: `nia_tracer` can stay non-blocking for deep jobs by returning the initial `job_id`, while `job_id` follow-up calls own the polling loop and can exercise abort/cancel behavior safely.
- 2026-03-18: Polling tests stay fast by injecting config overrides for `tracerTimeout` and `checkInterval`, while still asserting the tool forwards timeout milliseconds into the client layer.
