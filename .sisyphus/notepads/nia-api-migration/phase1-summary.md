# Phase 1 Bug Fixes - Summary

## Completed: 9 Bug Fixes

### Bug #1: nia_read line_start/line_end parameter names
**File**: `src/tools/nia-read.ts:71-72`
**Change**: Renamed outgoing query params from `start_line`/`end_line` to `line_start`/`line_end`
**Before**: `params.start_line = args.line_start; params.end_line = args.line_end;`
**After**: `params.line_start = args.line_start; params.line_end = args.line_end;`

### Bug #2: nia_context update PATCH→PUT
**File**: `src/tools/nia-context.ts:171`
**Change**: Changed HTTP method from PATCH to PUT for update action
**Before**: `client.patch<ContextResponse>(`/contexts/${args.id}`, ...)`
**After**: `client.put<ContextResponse>(`/contexts/${args.id}`, ...)`

### Bug #3: nia_context search query→q parameter
**File**: `src/tools/nia-context.ts:143`
**Change**: Renamed outgoing query param from `query` to `q`
**Before**: `const params = { query: args.query, ...}`
**After**: `const params = { q: args.query, ...}`
**Note**: Tool argument name stays as `query` for backwards compatibility

### Bug #4: nia_tracer deep mode endpoint path
**File**: `src/tools/nia-tracer.ts:112`
**Change**: Changed URL from `/github/tracer/jobs` to `/github/tracer`
**Before**: `client.post("/github/tracer/jobs", ...)`
**After**: `client.post("/github/tracer", ...)`

### Bug #5: SSE streaming /stream suffix
**File**: `src/state/job-manager.ts:64-66, 120-122`
**Change**: Appended `/stream` suffix to SSE endpoint paths in both consumeSSE and cancelJob methods
**Before**: `/oracle/jobs/${jobId}` and `/github/tracer/${jobId}`
**After**: `/oracle/jobs/${jobId}/stream` and `/github/tracer/${jobId}/stream`

### Bug #6: nia_package_search registry enum values
**File**: `src/tools/nia-package-search.ts:11-22`
**Change**: Added mapping function to translate plugin registry names to API enum values
**Mapping**:
- `pypi` → `py_pi`
- `crates` → `crates_io`
- `go` → `golang_proxy`
- `npm` → `npm` (unchanged)

### Bug #7: nia_package_search endpoint path
**File**: `src/tools/nia-package-search.ts:114`
**Change**: Updated endpoint URL from deprecated path to new path
**Before**: `client.post("/package-search/hybrid", ...)`
**After**: `client.post("/packages/search", ...)`

### Bug #8: nia_auto_subscribe endpoint split
**File**: `src/tools/nia-auto-subscribe.ts:113-117`
**Change**: Split `/dependencies` endpoint based on dry_run flag
**Before**: Always POST to `/dependencies`
**After**: 
- `dry_run=true` → POST to `/dependencies/analyze`
- `dry_run=false` → POST to `/dependencies/subscribe`

### Bug #9: source-resolver invalid source_type values
**File**: `src/tools/source-resolver.ts:9-20, 47-52`
**Changes**:
1. Removed invalid values `x` and `connector` from `VALID_SOURCE_TYPES`
2. Added mapping function to translate `data_source` to `documentation` for API calls
3. Kept `data_source` as valid input for backwards compatibility (translated at wire level)

## Test Updates

Updated test assertions in the following files to match corrected behavior:
- `src/tools/nia-read.test.ts`
- `src/tools/nia-context.test.ts`
- `src/tools/nia-tracer.test.ts`
- `src/tools/nia-package-search.test.ts`
- `src/state/job-manager.test.ts`
- `src/index.test.ts`
- `tests/integration/auto-subscribe-tracer.test.ts`

## Verification Results

✅ **TypeScript type check**: Pass (`bun run typecheck`)
✅ **Lint**: Pass (`bun run lint`)
✅ **Unit tests**: 413 pass, 0 fail (`bun test src/`)
✅ **Integration tests**: Updated (require NIA_API_KEY for live API testing)

## Files Modified

26 files changed, 358 insertions(+), 193 deletions(-)

## Next Steps

Phase 1 is complete and ready for commit. The 9 verified bugs have been fixed and all unit tests pass.
