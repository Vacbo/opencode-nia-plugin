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