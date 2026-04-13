# Phase 1 Execution Notepad

## Key Conventions
- Tool arg names stay stable; only wire-level payloads change
- All tests colocated as `src/**/*.test.ts`
- Integration tests gated on NIA_API_KEY
- Use existing harness pattern from tests/integration/real-api.test.ts

## Bug Fix Mapping

### Bug #1: nia_read line_start/line_end
**File**: src/tools/nia-read.ts:71-72
**Fix**: Rename outgoing query params from start_line/end_line to line_start/line_end
**Test**: src/tools/nia-read.test.ts

### Bug #2: nia_context PATCH→PUT
**File**: src/tools/nia-context.ts:171
**Fix**: Change client.patch to client.put
**Test**: src/tools/nia-context.test.ts

### Bug #3: nia_context query→q
**File**: src/tools/nia-context.ts:142-144
**Fix**: Rename outgoing param from query to q
**Test**: src/tools/nia-context.test.ts

### Bug #4: nia_tracer deep mode endpoint
**File**: src/tools/nia-tracer.ts:111-112
**Fix**: Change /github/tracer/jobs to /github/tracer
**Test**: src/tools/nia-tracer.test.ts

### Bug #5: SSE streaming /stream suffix
**File**: src/state/job-manager.ts:64-66
**Fix**: Append /stream to both oracle and tracer paths
**Test**: src/state/job-manager.test.ts

### Bug #6: nia_package_search registry enum
**File**: src/tools/nia-package-search.ts:11, 63
**Fix**: Map pypi→py_pi, crates→crates_io, go→golang_proxy
**Test**: src/tools/nia-package-search.test.ts

### Bug #7: nia_package_search endpoint
**File**: src/tools/nia-package-search.ts:114
**Fix**: Change /package-search/hybrid to /packages/search
**Test**: src/tools/nia-package-search.test.ts

### Bug #8: nia_auto_subscribe endpoint split
**File**: src/tools/nia-auto-subscribe.ts:114
**Fix**: Route dry_run=true to /dependencies/analyze, false to /dependencies/subscribe
**Test**: src/tools/nia-auto-subscribe.test.ts

### Bug #9: source-resolver invalid source_type
**Files**: 
- src/tools/source-resolver.ts:9-20 (centralized fix + data_source→documentation shim)
- src/tools/source-resolver.test.ts:60-76 (rewrite test)
- All tool schemas: remove x and connector, keep data_source as compat alias
**Test**: src/tools/source-resolver.test.ts + new src/tools/source-type-enum.test.ts

## Integration Test Updates
- tests/integration/auto-subscribe-tracer.test.ts:155-156 (Bug #8)
- tests/integration/auto-subscribe-tracer.test.ts:198-206 (Bug #4)

## Verification Gates
- [ ] bun test src/ — all unit tests pass
- [ ] bun run typecheck — no TypeScript errors
- [ ] bun run lint — biome passes
- [ ] bun run test:integration — all existing integration tests pass
- [ ] Phase 1 smoke test matrix (13 rows) passes

## Phase 4 SDK-only cleanup
- Removed the legacy NiaClient and the NIA_USE_SDK feature flag; plugin initialization now always creates the SDK adapter.
- Tool tests migrate cleanly by mocking the SDK adapter surface instead of the deleted HTTP client class.
- Shared API types now only keep plugin-internal contracts (source resolution, pending operations, SSE events, and error classification).
