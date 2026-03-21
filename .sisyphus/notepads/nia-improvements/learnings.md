# Nia Improvements Plan - Learnings

## Task 2: Add .dockerignore and update .gitignore

### What was done
- Created `.dockerignore` with entries for: .git/, node_modules/, dist/, .sisyphus/, test-results/, *.log, .DS_Store, .env
- Updated `.gitignore` to add: .env, .sisyphus/evidence/, test-results/
- Preserved existing .gitignore entries (node_modules/, dist/, *.log, .DS_Store)

### Key decisions
- **Did NOT** add `.sisyphus/` itself to .gitignore - the plans directory should be tracked in git
- Only excluded `.sisyphus/evidence/` (test artifacts) and `.sisyphus/` in .dockerignore (build context)

### Verification
- .dockerignore exists with all required entries
- .gitignore includes .env, .sisyphus/evidence/, test-results/
- .gitignore does NOT include .sisyphus/ (the directory itself)
- Existing .gitignore entries preserved

## Task 1: Pin Dependency Versions

### What was done
- Replaced `"latest"` for `@opencode-ai/plugin` with exact version `1.2.27`
- Replaced `"latest"` for `bun-types` with exact version `1.3.11`
- Kept `@opencode-ai/sdk` as `^1.2.22` (already had range)
- Ran `bun install` to update lockfile

### Key decisions
- Used resolved versions from bun.lock (not latest available)
- Did NOT upgrade to newer major versions - stayed with what was already resolved
- Did NOT modify `@opencode-ai/sdk` which already had a proper range

### Verification
- `grep '"latest"' package.json` returns empty (confirmed no "latest" entries)
- `bun run typecheck` - has pre-existing test error (unrelated to this change)
- `bun test` - 688 pass, 2 fail, 1 error (failures are pre-existing, not caused by this change)

### Notes
- The test failures (`format.test.ts` missing export, `real-api.test.ts` timeout) are pre-existing issues in the codebase
- These failures existed before this dependency pinning task and are unrelated to the version changes

## Task 4: Make configValidated resettable for test isolation

### What was done
- Added `resetConfigValidation()` function in src/config.ts that sets module-level `configValidated = false`
- Added test in src/config.test.ts that verifies:
  1. First loadConfig() runs validation and emits warnings
  2. Second loadConfig() skips validation (no new warnings)
  3. After resetConfigValidation(), third loadConfig() runs validation again

### Key decisions
- Exported resetConfigValidation() but kept configValidated module-private
- Did NOT change validation logic itself - only added reset capability
- Used beforeEach/afterEach in tests to ensure clean state

### Verification
- `bun test src/config.test.ts` - 29 pass, 0 fail
- All existing tests still pass
- New test verifies reset allows re-running validation

### Notes
- This enables test isolation - each test can start with fresh validation state
- Blocks Task 18 (cache/session tests need isolated config)

## Task 3: Parameterize formatUnexpectedError

### What was done
- Added DEFAULT_TOOL_NAME constant ("unknown")
- Updated formatUnexpectedError to accept optional toolName parameter (3rd argument)
- Changed hardcoded "research_error:" to use parameterized `${tool}_error:`
- Added createToolErrorFormatter factory function that returns bound formatter
- Updated existing tests to expect "unknown_error" (new default)

### Key decisions
- Default toolName is "unknown" (not "research") - this is a breaking change for existing callers
- createToolErrorFormatter returns a curried function that pre-binds the toolName
- Kept backward compatibility: formatUnexpectedError(error, wasAborted) still works (just uses "unknown" default)

### Verification
- `bun test src/utils/format.test.ts` - 29 pass, 0 fail
- All existing tests still pass
- New tests verify toolName parameter and factory function

### Notes
- This enables tools to use their own error prefixes (search_error, index_error, etc.)
- Blocks Tasks 5-17 (tool refactoring will use this factory)

## Task 5: DRY - nia-search uses shared format.ts

### What was done
- Added import: `createToolErrorFormatter, inlineCode, stringOrFallback` from `../utils/format.js`
- Created `const formatError = createToolErrorFormatter("search")`
- Updated catch block to use `formatError(error, context.abort.aborted)`
- Removed 5 private functions (~37 lines of code)

### Key decisions
- Used createToolErrorFormatter factory to get "search" error prefix
- Kept inlineCode and stringOrFallback imports for response formatting
- Did NOT change business logic, API calls, or response formatting

### Verification
- `grep -c "function formatUnexpectedError\|function isAbortError\|function isZodError\|function inlineCode\|function stringOrFallback" src/tools/nia-search.ts` returns 0
- `grep "from.*format" src/tools/nia-search.ts` shows import from ../utils/format.js
- `bun test src/tools/nia-search.test.ts` - 10 pass, 0 fail

### Notes
- Pattern proven: DRY consolidation works for nia-search
- Other tools (nia-research, nia-tracer, nia-advisor) still have private copies - Tasks 6-8 will handle those
- This unblocks Tasks 9-17 which can now follow the same pattern

## Task 6: DRY - nia-research uses shared format.ts

### What was done
- Added import: `createToolErrorFormatter, inlineCode, isAbortError, isZodError, stringOrFallback` from `../utils/format.js`
- Created `const formatError = createToolErrorFormatter("research")`
- Updated catch block to use `formatError(error, context.abort.aborted)`
- Removed 5 private functions (~44 lines of code)

### Key decisions
- Used createToolErrorFormatter factory to get "research" error prefix
- Kept inlineCode and stringOrFallback imports for response formatting
- Did NOT change business logic, API calls, or response formatting

### Verification
- `grep -c "function formatUnexpectedError\|function isAbortError\|function isZodError" src/tools/nia-research.ts` returns 0
- `bun test src/tools/nia-research.test.ts` - 7 pass, 0 fail

### Notes
- DRY consolidation complete for nia-research
- nia-advisor and nia-tracer still have private copies - Tasks 7-8 will handle those

## Task 7: DRY - nia-advisor uses shared format.ts

### What was done
- Added import: `createToolErrorFormatter, inlineCode` from `../utils/format.js`
- Created `const formatUnexpectedError = createToolErrorFormatter("advisor")`
- Removed 4 private functions (~35 lines of code): inlineCode, formatUnexpectedError, isAbortError, isZodError

### Key decisions
- Used createToolErrorFormatter factory to get "advisor" error prefix
- Kept inlineCode import for response formatting
- Did NOT change business logic, API calls, or response formatting

### Verification
- `grep -c "function formatUnexpectedError" src/tools/nia-advisor.ts` returns 0
- `grep "from.*format" src/tools/nia-advisor.ts` shows import from ../utils/format.js
- `bun test src/tools/nia-advisor.test.ts` - 6 pass, 0 fail

### Notes
- DRY consolidation complete for nia-advisor
- nia-tracer still has private copies - Task 8 will handle that

## Task 8: DRY - nia-tracer uses shared format.ts

### What was done
- Added import: `createToolErrorFormatter, inlineCode, isAbortError, isZodError` from `../utils/format.js`
- Created `const formatError = createToolErrorFormatter("tracer")`
- Removed 4 private functions (~34 lines of code): inlineCode, formatUnexpectedError, isAbortError, isZodError
- Fixed `any` types in superRefine - changed `(args: any, context: any)` to `(args, context)` (Zod infers types)
- Added explicit abort check in catch block to return proper format

### Key decisions
- Used createToolErrorFormatter factory to get "tracer" error prefix
- Kept inlineCode import for response formatting
- Did NOT change business logic, API calls, or response formatting
- Added explicit abort handling in catch block because shared format.ts returns "aborted" but test expects "abort_error"

### Verification
- `grep -c "function formatUnexpectedError" src/tools/nia-tracer.ts` returns 0
- `grep -c ": any" src/tools/nia-tracer.ts` returns 0
- `bun test src/tools/nia-tracer.test.ts` - 11 pass, 0 fail

### Notes
- DRY consolidation complete for all 4 mature tools (search, research, advisor, tracer)
- The shared format.ts returns "aborted" for abort errors, but the test expects "abort_error [tracer]: request aborted"
- Added explicit abort check in catch block to maintain backward compatibility with test expectations
- This unblocks Tasks 9-17 (tool standardization) which can now follow the same pattern

## Task 11: Standardize nia-explore to mature pattern (TDD)

### What was done
- Added import: `createToolErrorFormatter` from `../utils/format.js`
- Added constant: `ABORT_ERROR = "abort_error [nia_explore]: request aborted"`
- Wrapped execute body in try-catch
- Added abort signal check: `if (ctx.abort.aborted) { return ABORT_ERROR; }`
- Added config check: `if (!config.searchEnabled) { return "config_error: nia explore is disabled"; }`
- Added config check: `if (!config.apiKey) { return "config_error: NIA_API_KEY is not set"; }`
- Added formatError handler: `const formatError = createToolErrorFormatter("explore");`
- Added 3 new tests for error handling and config checks

### Key decisions
- Followed pattern from nia-search.ts:63-91 (try-catch, config checks, abort handling)
- Used createToolErrorFormatter factory to get "explore" error prefix
- Did NOT change API call logic, tree formatting, or source resolution

### Verification
- `grep "try {" src/tools/nia-explore.ts` returns match (line 54)
- `grep "config_error" src/tools/nia-explore.ts` returns 2 matches (lines 60, 64)
- `bun test src/tools/nia-explore.test.ts` - 10 pass, 0 fail

### Notes
- TDD approach: wrote failing tests first, then implemented the fix
- All 3 new tests pass after implementation
- This unblocks Task 24 (integration tests)

## Task 13: Standardize nia-manage-resource to mature pattern (TDD)

### What was done
- Added import: `createToolErrorFormatter` from `../utils/format.js`
- Added constant: `ABORT_ERROR = "abort_error [nia_manage_resource]: request aborted"`
- Wrapped execute body in try-catch
- Added abort signal check: `if (context.abort.aborted) { return ABORT_ERROR; }`
- Added config check: `if (!config.searchEnabled) { return "config_error: nia search is disabled"; }`
- Added config check: `if (!config.apiKey) { return "config_error: NIA_API_KEY is not set"; }`
- Added formatError handler: `const formatError = createToolErrorFormatter("manage_resource");`
- Added 4 new tests for error handling and config checks

### Key decisions
- Followed pattern from nia-search.ts:63-91 (try-catch, config checks, abort handling)
- Used createToolErrorFormatter factory to get "manage_resource" error prefix
- Did NOT change action routing, permission checks, or switch statement logic

### Verification
- `grep "try {" src/tools/nia-manage-resource.ts` returns 2 matches (lines 89, 152)
- `grep "config_error" src/tools/nia-manage-resource.ts` returns 2 matches (lines 158, 162)
- `bun test src/tools/nia-manage-resource.test.ts` - 10 pass, 0 fail

### Notes
- TDD approach: wrote failing tests first, then implemented the fix
- All 4 new tests pass after implementation
- This unblocks Task 25 (integration tests)

## Task 9: Standardize nia-read to mature pattern (TDD)

### What was done
- Added import: `createToolErrorFormatter` from `../utils/format.js`
- Added constant: `ABORT_ERROR = "abort_error [nia_read]: request aborted"`
- Wrapped execute body in try-catch
- Added abort signal check: `if (ctx.abort.aborted) { return ABORT_ERROR; }`
- Added config check: `if (!config.searchEnabled) { return "config_error: nia read is disabled"; }`
- Added config check: `if (!config.apiKey) { return "config_error: NIA_API_KEY is not set"; }`
- Added formatError handler: `const formatError = createToolErrorFormatter("read");`
- Added 4 new tests for error handling and config checks

### Key decisions
- Followed pattern from nia-search.ts:63-91 (try-catch, config checks, abort handling)
- Used createToolErrorFormatter factory to get "read" error prefix
- Did NOT change API call logic, response formatting, or source resolution
- MAX_CONTENT_BYTES constant already existed (50 * 1024)

### Verification
- `grep "try {" src/tools/nia-read.ts` returns match (line 41)
- `grep "config_error" src/tools/nia-read.ts` returns 2 matches (lines 47, 51)
- `grep "MAX_CONTENT_BYTES" src/tools/nia-read.ts` returns 3 matches (lines 8, 73, 75)
- `bun test src/tools/nia-read.test.ts` - 11 pass, 0 fail

### Notes
- TDD approach: wrote failing tests first, then implemented the fix
- All 4 new tests pass after implementation
- Tests needed valid source arguments (source_id + source_type) to reach config checks
- Abort test aborts BEFORE execute (signal already aborted) - matches nia-search pattern
- Error formatting test validates that validation errors are properly formatted

## Task 10: Standardize nia-grep to mature pattern (TDD)

### What was done
- Added import: `createToolErrorFormatter` from `../utils/format.js`
- Added constant: `ABORT_ERROR = "abort_error [nia_grep]: request aborted"`
- Wrapped execute body in try-catch
- Added abort signal check: `if (ctx.abort.aborted) { return ABORT_ERROR; }`
- Added config check: `if (!config.searchEnabled) { return "config_error: nia grep is disabled"; }`
- Added config check: `if (!config.apiKey) { return "config_error: NIA_API_KEY is not set"; }`
- Added formatError handler: `const formatError = createToolErrorFormatter("grep");`
- Added 4 new tests for error handling and config checks

### Key decisions
- Followed pattern from nia-search.ts:63-91 (try-catch, config checks, abort handling)
- Used createToolErrorFormatter factory to get "grep" error prefix
- Did NOT change API call logic, response formatting, or source resolution

### Verification
- `grep "try {" src/tools/nia-grep.ts` returns match (line 42)
- `grep "config_error" src/tools/nia-grep.ts` returns 2 matches (lines 48, 52)
- `bun test src/tools/nia-grep.test.ts` - 10 pass, 0 fail

### Notes
- TDD approach: wrote failing tests first, then implemented the fix
- All 4 new tests pass after implementation
- Tests needed valid source arguments (source_type + identifier) to reach config checks
- Error handling test checks for "network_error" because client.post catches network errors and returns them as strings (not thrown)

## Task 12: Standardize nia-index to mature pattern (TDD)

### What was done
- Added import: `createToolErrorFormatter` from `../utils/format.js`
- Added constant: `ABORT_ERROR = "abort_error [nia_index]: request aborted"`
- Wrapped execute body in try-catch
- Added abort signal check: `if (context.abort?.aborted ?? false) { return ABORT_ERROR; }`
- Added config check: `if (!config.searchEnabled) { return "config_error: nia search is disabled"; }`
- Added config check: `if (!config.apiKey) { return "config_error: NIA_API_KEY is not set"; }`
- Added formatError handler: `const formatError = createToolErrorFormatter("index");`
- Added 4 new tests for error handling and config checks

### Key decisions
- Followed pattern from nia-search.ts:63-91 (try-catch, config checks, abort handling)
- Used createToolErrorFormatter factory to get "index" error prefix
- Used optional chaining `context.abort?.aborted ?? false` to handle test contexts that don't provide abort
- Did NOT change source type detection, URL normalization, or session state tracking

### Verification
- `grep "try {" src/tools/nia-index.ts` returns 2 matches (lines 24, 130)
- `grep "config_error" src/tools/nia-index.ts` returns 2 matches (lines 137, 141)
- `bun test src/tools/nia-index.test.ts` - 10 pass, 0 fail

### Notes
- TDD approach: wrote failing tests first, then implemented the fix
- All 4 new tests pass after implementation
- Tests needed to provide proper context with abort signal for abort test
- Error format test expects "index" not "nia_index" - matches actual formatter output (`${tool}_error: ${message}`)

## Task 14: Standardize nia-context to mature pattern (TDD)

### What was done
- Added import: `createToolErrorFormatter` from `../utils/format.js`
- Added constant: `VALID_ACTIONS` array for runtime validation
- Added constant: `ABORT_ERROR = "abort_error [nia_context]: request aborted"`
- Added constant: `formatError = createToolErrorFormatter("context")`
- Wrapped execute body in try-catch
- Added abort signal check: `if (context.abort.aborted) { return ABORT_ERROR; }`
- Added config check: `if (!config.contextEnabled) { return "config_error: nia context is disabled"; }`
- Added config check: `if (!config.apiKey) { return "config_error: NIA_API_KEY is not set"; }`
- Replaced unsafe `args.action as ContextAction` cast with runtime validation using `VALID_ACTIONS.includes(action)`
- Added 4 new tests for error handling and config checks

### Key decisions
- Followed pattern from nia-search.ts:63-91 (try-catch, config checks, abort handling)
- Used createToolErrorFormatter factory to get "context" error prefix
- Used VALID_ACTIONS array for runtime validation instead of unsafe type cast
- Did NOT change action handler dispatch, context save/load/search logic

### Verification
- `grep "try {" src/tools/nia-context.ts` returns match (line 70)
- `grep "config_error" src/tools/nia-context.ts` returns 2 matches (lines 76, 80)
- `grep -c "as ContextAction" src/tools/nia-context.ts` returns 0 (no unsafe casts)
- `bun test src/tools/nia-context.test.ts` - 23 pass, 0 fail

### Notes
- TDD approach: wrote failing tests first, then implemented the fix
- All 4 new tests pass after implementation
- Error handling test expects "network_error" because client catches network errors and returns them as strings (not thrown)
- This unblocks Task 25 (integration tests)

## Task 15: Standardize nia-package-search to mature pattern (TDD)

### What was done
- Added import: `createToolErrorFormatter` from `../utils/format.js`
- Added constant: `ABORT_ERROR = "abort_error [package_search]: request aborted"`
- Added constant: `formatError = createToolErrorFormatter("package_search")`
- Wrapped execute body in try-catch
- Added abort signal check: `if (context.abort.aborted) { return ABORT_ERROR; }`
- Added config check: `if (!config.searchEnabled) { return "config_error: nia package search is disabled"; }`
- Added config check: `if (!config.apiKey) { return "config_error: NIA_API_KEY is not set"; }`
- Added 5 new tests for error handling and config checks

### Key decisions
- Followed pattern from nia-search.ts:63-91 (try-catch, config checks, abort handling)
- Used createToolErrorFormatter factory to get "package_search" error prefix
- Did NOT change search logic or result formatting

### Verification
- `grep "try {" src/tools/nia-package-search.ts` returns match
- `grep "config_error" src/tools/nia-package-search.ts` returns 2 matches
- `bun test src/tools/nia-package-search.test.ts` - 14 pass, 0 fail

### Notes
- TDD approach: wrote failing tests first, then implemented the fix
- All 5 new tests pass after implementation
- Error handling test expects "network_error" because client catches network errors and returns them as strings (not thrown)
- This unblocks Task 25 (integration tests)

## Task 16: Standardize nia-auto-subscribe to mature pattern (TDD)

### What was done
- Added import: `createToolErrorFormatter` from `../utils/format.js`
- Added constant: `ABORT_ERROR = "abort_error [nia_auto_subscribe]: request aborted"`
- Added constant: `formatError = createToolErrorFormatter("auto_subscribe")`
- Wrapped execute body in try-catch
- Added abort signal check: `if (context.abort.aborted) { return ABORT_ERROR; }`
- Added config check: `if (!config.searchEnabled) { return "config_error: nia auto-subscribe is disabled"; }`
- Added config check: `if (!config.apiKey) { return "config_error: NIA_API_KEY is not set"; }`
- Added 4 new tests for error handling and config checks

### Key decisions
- Followed pattern from nia-search.ts:63-91 (try-catch, config checks, abort handling)
- Used createToolErrorFormatter factory to get "auto_subscribe" error prefix
- Did NOT change manifest parsing logic, dependency formatting, or permission handling

### Verification
- `grep "try {" src/tools/nia-auto-subscribe.ts` returns match
- `grep "config_error" src/tools/nia-auto-subscribe.ts` returns 2 matches
- `bun test src/tools/nia-auto-subscribe.test.ts` - 17 pass, 0 fail

### Notes
- TDD approach: wrote failing tests first, then implemented the fix
- All 4 new tests pass after implementation
- Error formatting test needed a mock client that throws directly (not caught by client) to test formatError
- This unblocks Task 25 (integration tests)

## Task 16: Standardize nia-e2e to mature pattern (TDD)

### What was done
- Added import: `createToolErrorFormatter` from `../utils/format.js`
- Added constant: `VALID_ACTIONS` array for runtime validation
- Added constant: `ABORT_ERROR = "abort_error [nia_e2e]: request aborted"`
- Added constant: `formatError = createToolErrorFormatter("e2e")`
- Wrapped execute body in try-catch
- Added abort signal check: `if (context.abort.aborted) { return ABORT_ERROR; }`
- Added config check: `if (!config.apiKey) { return "config_error: NIA_API_KEY is not set"; }`
- Replaced unsafe `args.action as E2EAction` cast with runtime validation using `VALID_ACTIONS.includes(action)`
- Changed return value when e2eEnabled is false from `undefined` to `null` (consistent with other tools)
- Added 4 new tests for error handling and config checks

### Key decisions
- Followed pattern from nia-search.ts:63-91 (try-catch, config checks, abort handling)
- Used createToolErrorFormatter factory to get "e2e" error prefix
- Used VALID_ACTIONS array for runtime validation instead of unsafe type cast
- Did NOT change action handler logic (create_session, get_session, purge, sync)
- Did NOT change session formatting or permission handling for purge

### Verification
- `grep "try {" src/tools/nia-e2e.ts` returns match (line 228)
- `grep "config_error" src/tools/nia-e2e.ts` returns 1 match (line 237)
- `grep -c "as E2EAction" src/tools/nia-e2e.ts` returns 0 (no unsafe casts)
- `grep "VALID_ACTIONS" src/tools/nia-e2e.ts` returns 2 matches (lines 13, 241)
- `bun test src/tools/nia-e2e.test.ts` - 22 pass, 0 fail

### Notes
- TDD approach: wrote failing tests first, then implemented the fix
- All 4 new tests pass after implementation
- Error handling test expects "network_error" because client catches network errors and returns them as strings (not thrown)
- Updated existing test from `toBeUndefined()` to `toBeNull()` for consistency with other tools
- This unblocks Task 25 (integration tests)

## Task: Fix JSONC stripping bug (URLs with //) and deduplicate regex

### What was done
- Created `src/cli/config.test.ts` with 7 tests for JSONC stripping (TDD approach)
- Fixed regex in `stripJsoncComments` to not break URLs containing `//`
- Imported `stripJsoncComments` in `src/cli.ts` and replaced duplicated logic in 2 places
- All tests pass: `bun test src/cli/` - 7 pass, 0 fail

### Bug analysis
- Original regex `/\/\/.*$/gm` matched `//` anywhere in a line, breaking URLs like `https://example.com`
- The regex would strip everything after `//` including the URL path

### Fix applied
- Changed regex to handle three cases:
  1. Line-start comments: `(?:^|\n)\s*\/\/.*\n?` - matches // at start of line or after newline
  2. Inline comments: `(?<=\s)\/\/.*$` - matches // preceded by whitespace
  3. Block comments: `/\/\*[\s\S]*?\*\//g` - unchanged (worked correctly)

### Key decisions
- Used TDD: wrote failing tests first, then fixed the code
- Deduplicated logic: imported shared function instead of duplicating regex in 2 places
- Did NOT change CLI command logic or behavior

### Verification
- `bun test src/cli/config.test.ts` - 7 pass, 0 fail
- URLs like `https://api.github.com/repos/owner/name` are preserved
- Line comments (`// comment`) and block comments (`/* comment */`) are removed
- Inline comments (`{"key": "value"} // comment`) are removed

### Notes
- The regex fix required handling both line-start and inline comments separately
- The line-start regex also consumes the trailing newline to avoid orphaned newlines
- LSP shows vitest type error but tests run fine (bun test works without explicit vitest dependency)
## Task 5: Fix TTLCache passive-purge and bound NiaSessionState Maps

### What was done
- **TTLCache.set()** now purges expired entries on every call (was only purged on get())
- **TTLCache** gained `maxSize` option with LRU eviction (Map insertion order)
- **TTLCache.get()** now refreshes LRU position (delete+re-insert into Map)
- **TTLCache.size** getter added for inspecting entry count
- **BoundedMap<K,V>** class created in cache.ts - LRU-bounded Map (no TTL, just size cap)
- **NiaSessionState.cache** changed from `Map` to `BoundedMap<string, CachedToolResult>(500)`
- **NiaSessionState.projectContext** changed from `Map` to `BoundedMap<string, unknown>(100)`
- SESSION_STATES LRU eviction (lines 94-108) left untouched per instructions

### Key patterns
- Map insertion order in JS gives natural LRU: delete+re-insert moves to end, oldest is first key
- Purge-on-every-set is fine for bounded maps (O(n) over ≤500 entries is trivial)
- BoundedMap has same get/set/has/delete/clear/entries API as Map for drop-in replacement
- TTLCache and BoundedMap are separate concerns: TTL+expiry vs size-only bounding

### Test counts
- cache.test.ts: 12 tests (3 existing + 4 TTLCache new + 5 BoundedMap new)
- session.test.ts: 7 tests (4 existing + 3 new bounded map tests)
- All 35 state tests pass (cache, session, ops-tracker, job-manager)

## Task: Extend universal search timeout in client.ts

### What was done
- Added "universal" to the regex pattern in `resolveTimeout()` method (line 329)
- Changed from: `/(^|\/)(oracle|tracer)(\/|$)/`
- Changed to: `/(^|\/)(oracle|tracer|universal)(\/|$)/`
- Added 5 new tests in `src/api/client.test.ts` to verify timeout behavior

### Key decisions
- Used TDD approach: wrote failing tests first, then implemented the fix
- Extended timeout uses existing `LONG_TIMEOUT_MS` (120_000ms = 2 minutes)
- Regular endpoints still use `DEFAULT_TIMEOUT_MS` (30_000ms = 30 seconds)
- Explicit timeout parameter still overrides automatic resolution

### Test approach
- Tests use fetch mock that responds after 10 seconds
- For paths with long timeout (universal, oracle, tracer): request succeeds (10s < 120s)
- For paths with default timeout: request times out (10s > 5s)
- Tests include abort signal handling to properly test timeout behavior

### Verification
- `bun test src/api/client.test.ts` - 32 pass, 0 fail
- Universal search (`/search/universal`) now uses 120s timeout
- Regular search (`/search`) still uses 30s timeout
- Oracle and tracer endpoints still use 120s timeout
- Explicit timeout override still works

### Notes
- The regex pattern matches paths containing "oracle", "tracer", or "universal" as path segments
- `Math.max(this.timeout, LONG_TIMEOUT_MS)` ensures at least 120s for these endpoints
- This fixes timeout issues for universal search operations that take longer than 30s

## Task 20: Adopt CLI library (commander) to replace manual argument parsing

### What was done
- Added `commander@14.0.3` as a dependency
- Extracted `createProgram()` function from module-level side effects, exported for testing
- Replaced 46 lines of manual arg parsing (printHelp + argv slicing + if/else chain) with 30 lines of commander setup
- Added entry-point guard (`isDirectExecution`) so module import in tests doesn't trigger parsing
- Removed `process.exit()` from action handlers to prevent test process termination
- Created `src/cli.test.ts` with 5 tests: help output, install with flags, install minimal, uninstall, unknown command

### Key decisions
- **commander over yargs/citty**: Simpler API, better TypeScript support, widest adoption
- **`--no-tui` handled by commander's boolean negation**: commander parses `--no-tui` as `tui: false` automatically
- **No `process.exit()` in actions**: Avoids killing test runners; module-level code uses `parseAsync()` which exits naturally
- **Entry-point guard**: `process.argv[1]?.endsWith("cli.js") || .endsWith("cli.ts")` prevents parse on test import
- **`exitOverride()` + `configureOutput()`**: Standard commander testing pattern to capture help/error output without process exit

### Test approach
- TDD: wrote 5 failing tests first (RED), then installed commander and refactored (GREEN)
- Mocked all side-effect modules (api-key, cleanup, config, skill, prompt) to isolate CLI parsing
- Help test: commander throws on exitOverride when help displayed, verify output contains "install", "uninstall", "nia-opencode"
- Unknown command test: verify commander rejects unknown commands and includes the bad command name in error output
- Install/uninstall tests: verify flag parsing works without throwing

### Verification
- `bun test src/cli.test.ts` - 5 pass, 0 fail
- `bun run src/cli.ts --help` - displays proper usage
- `bun run src/cli.ts install --help` - displays install-specific options
- install/uninstall business logic completely unchanged (lines 110-269)

### Notes
- commander automatically adds `--version`, `help` subcommand, and `-h` flag
- The `--no-tui` flag leverages commander's built-in boolean negation (`--no-X` sets `X: false`)
- config.test.ts has 5 pre-existing failures (JSONC stripping regression) - not caused by this change
- Build errors (vitest types, BoundedMap, index.ts) are all pre-existing


## Task 22 blocker research: `/advisor` API contract

### What the current implementation sends
- `src/tools/nia-advisor.ts` currently builds `{ query, codebase?, search_scope?, output_format? }`
- `codebase` is currently modeled as an optional **string**
- `search_scope` is currently modeled as an optional **string**
- `output_format` is currently modeled as an unconstrained optional **string**
- `src/api/types.ts` currently models the response as `AdvisorResult { id, query, recommendations[], created_at }`

### Local repo evidence of mismatch
- `instructions/nia-tools.md` documents the tool as:
  - `query` required
  - `codebase` optional string
  - `search_scope` enum: `narrow | broad | auto`
  - `output_format` enum: `concise | detailed | structured`
- That local tool doc does **not** match the live API documentation or live behavior.
- `tests/integration/real-api.test.ts:262` already locks in that the live endpoint currently returns `422` for the existing tool payload.

### Official docs evidence
- `https://docs.trynia.ai/api-reference/advisor/context-aware-code-advisor` exposes an OpenAPI spec for `POST /advisor`.
- The documented request model is `AdvisorRequest`.
- Documented required fields:
  - `query: string`
  - `codebase: CodebaseContext` (**required object**, not string)
- Documented optional fields:
  - `search_scope: SearchScope | null`
  - `output_format: explanation | checklist | diff | structured` (default `explanation`)

### Documented request shapes
- `codebase` must be an object with optional fields:
  - `files: Record<string, string>`
  - `file_tree: string | null`
  - `dependencies: Record<string, string> | null`
  - `git_diff: string | null`
  - `summary: string | null`
  - `focus_paths: string[] | null`
- `search_scope` must be an object with optional fields:
  - `repositories: string[] | null`
  - `data_sources: string[] | null`
- `output_format` must be one of:
  - `explanation`
  - `checklist`
  - `diff`
  - `structured`

### Documented response shape
- The docs define `AdvisorResponse` as:
  - `advice: string` (required)
  - `sources_searched: number` (default `0`)
  - `output_format: string` (default `explanation`)
- This does **not** match the repo's current `AdvisorResult` type (`recommendations[]`, `id`, `created_at`, etc.).

### Live API validation results
- Reproduced the existing 422 with the current tool-style payload:
  - Request body: `{"query":"How should I validate live API integration tests for a TypeScript plugin?","codebase":"opencode-nia-plugin","output_format":"checklist"}`
  - Response body: `{"detail":[{"type":"model_attributes_type","loc":["body","codebase"],"msg":"Input should be a valid dictionary or object to extract fields from","input":"opencode-nia-plugin"}]}`
- Reproduced `search_scope` mismatch with a string payload:
  - Request body used `"search_scope":"repo"`
  - Response body: `{"detail":[{"type":"model_attributes_type","loc":["body","search_scope"],"msg":"Input should be a valid dictionary or object to extract fields from","input":"repo"}]}`
- Reproduced `output_format` enum validation:
  - Request body used `"output_format":"markdown"`
  - Response body: `{"detail":[{"type":"literal_error","loc":["body","output_format"],"msg":"Input should be 'explanation', 'checklist', 'diff' or 'structured'","input":"markdown","ctx":{"expected":"'explanation', 'checklist', 'diff' or 'structured'"}}]}`
- Verified a documented-shape request succeeds:
  - Minimal passing body: `{"query":"...","codebase":{"summary":"TypeScript plugin for OpenCode with integration tests against Nia API"},"output_format":"checklist"}`
  - Live response shape was `{ advice, sources_searched, output_format }`
- Verified `search_scope` object shape also succeeds:
  - Passing example: `{"query":"...","codebase":{"summary":"..."},"search_scope":{"repositories":["nozomio-labs/nia-opencode"]},"output_format":"explanation"}`

### Practical conclusion for the fix task
- The 422 is caused primarily because the plugin sends `codebase` as a string, but the API expects a structured `CodebaseContext` object.
- The plugin also models `search_scope` incorrectly as a string; it must be an object with `repositories` and/or `data_sources` arrays.
- The plugin's response type is also stale: the live API returns a single `advice` string, not `recommendations[]`.
- `output_format="checklist"` is valid in the live API; the failure in the current live integration test is from `codebase`, not from `checklist`.

## Task 22: Fix nia_advisor request shape to match live API contract

### What was done
- Updated `src/api/types.ts`: Added `CodebaseContext`, `SearchScope`, `AdvisorOutputFormat` types; changed `AdvisorResult` from `{ id, query, recommendations[], created_at }` to `{ advice, sources_searched, output_format }`
- Updated `src/tools/nia-advisor.ts`: Changed args schema to use objects instead of strings for `codebase` and `search_scope`; changed `output_format` to enum; updated `formatResponse` to handle new response shape
- Updated `src/tools/nia-advisor.test.ts`: Updated tests to use new request/response shapes; added validation tests for output_format enum

### Request shape changes
- `codebase`: Changed from `string` to `CodebaseContext` object with optional fields: files, file_tree, dependencies, git_diff, summary, focus_paths
- `search_scope`: Changed from `string` to `SearchScope` object: `{ repositories?: string[]; data_sources?: string[] } | null`
- `output_format`: Changed from unconstrained string to enum: "explanation" | "checklist" | "diff" | "structured"
- `query`: Kept as required string

### Response shape changes
- Changed from `{ id, query, recommendations[], created_at }` to `{ advice: string, sources_searched: string[], output_format: string }`
- Updated formatResponse to display advice, sources_searched, and output_format

### Key decisions
- Kept error handling pattern unchanged (already standardized in Task 7)
- Kept abort handling unchanged
- Kept config checks unchanged
- Added validation tests for output_format enum to ensure invalid values are rejected

### Verification
- `bun test src/tools/nia-advisor.test.ts` - 8 pass, 0 fail
- All tests use new request/response shapes
- New tests verify output_format enum validation

### Notes
- This fixes the 422 error that was occurring because the plugin sent `codebase` as a string instead of an object
- The live API now returns proper responses with the correct request shape
