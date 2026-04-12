# Phase 2 Migration Summary - Unified Endpoints

## Completed: Unified Endpoint Migration (v0.4.0)

### Migrations Completed

#### 1. nia_index.ts - Unified /sources endpoint
**Before:**
- `/repositories` for GitHub repos
- `/data-sources` for documentation
- `/research-papers` for papers

**After:**
- `/sources` for all source types with `type` discriminator
- Repository: `{type: "repository", url, repository}`
- Documentation: `{type: "documentation", url, display_name}`
- Research Paper: `{type: "research_paper", url}`

#### 2. nia_search.ts - Unified POST /search endpoint
**Before:**
- `/search/universal`
- `/search/query`
- `/search/web`
- `/search/deep`

**After:**
- `/search` with `mode` in request body
- All modes use same endpoint: `{query, mode: "universal|query|web|deep", ...}`

#### 3. nia_research.ts - Unified POST /search endpoint
**Before:**
- `/search/web` for quick mode
- `/search/deep` for deep mode

**After:**
- `/search` with `mode: "web"` or `mode: "deep"` in body

#### 4. nia_manage_resource.ts - Unified /sources endpoint
**Before:**
- `/repositories` for repository CRUD
- `/data-sources` for data source CRUD
- `/research-papers` for paper CRUD
- `/{type}/{id}/subscribe` for subscription

**After:**
- `/sources` for all source type CRUD
- `/sources?type=repository` for listing repos
- `/sources?type=documentation` for listing docs
- Subscribe action returns deprecation notice (no HTTP call)

#### 5. ops-tracker.ts - Unified /sources endpoint
**Before:**
- `/repositories/{id}` for repo operations
- `/data-sources/{id}` for doc operations

**After:**
- `/sources/{id}` for all source types

### Subscribe Deprecation
The `subscribe` action now returns:
```
deprecated: the unified Nia API no longer supports per-source subscription. Use category organization or the dependencies endpoints instead.
```

### Verification Results

✅ **TypeScript**: `bun run typecheck` - Pass
✅ **Lint**: `bun run lint` - Pass (67 files, no issues)
✅ **Unit Tests**: 413 pass, 0 fail
✅ **Version**: Bumped to 0.4.0
✅ **Grep Gate**: Zero deprecated paths in production code

### Files Modified
- `src/tools/nia-index.ts`
- `src/tools/nia-search.ts`
- `src/tools/nia-research.ts`
- `src/tools/nia-manage-resource.ts`
- `src/state/ops-tracker.ts`
- `src/tools/nia-index.test.ts`
- `src/tools/nia-search.test.ts`
- `src/tools/nia-research.test.ts`
- `src/tools/nia-manage-resource.test.ts`
- `src/state/ops-tracker.test.ts`
- `package.json` (version bump)

### Schema Stability Maintained
- All tool argument schemas unchanged
- `data_source` still accepted, mapped to `documentation` on wire
- Subscribe action still in enum, but returns deprecation notice

## Next Steps
Phase 3 (SDK Adoption) can begin when ready. The plugin now uses unified endpoints exclusively.
