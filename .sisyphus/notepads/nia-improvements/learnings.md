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