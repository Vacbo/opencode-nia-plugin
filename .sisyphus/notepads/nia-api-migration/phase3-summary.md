# Phase 3 SDK Migration Summary

## Completed: SDK Infrastructure + Core Tools

### Infrastructure (Committed)
- ✅ Installed `nia-ai-ts@0.5.0` SDK dependency
- ✅ Added `NIA_USE_SDK` config flag (default: `false`)
- ✅ Created SDK adapter layer (`src/api/nia-sdk.ts`)
- ✅ Updated `index.ts` to conditionally use SDK
- ✅ Version bumped to `0.5.0-beta.0`

### Tools Migrated to SDK (with dual-path support)

#### 1. nia_search ✅
**SDK Methods Used:**
- `sdk.search.universal()`
- `sdk.search.query()`
- `sdk.search.web()`
- `sdk.search.deep()`

**Status:** All 10 tests pass

#### 2. nia_research ✅
**SDK Methods Used:**
- `sdk.search.web()` (for quick mode)
- `sdk.search.deep()` (for deep mode)
- `sdk.oracle.createJob()` (for oracle mode)
- `sdk.oracle.getJob()` (for job status check)

**Status:** All 7 tests pass

#### 3. nia_index ✅
**SDK Methods Used:**
- `sdk.sources.create()`

**Status:** All tests pass

### SDK Limitations Discovered

The `nia-ai-ts` SDK (v0.5.0) has limited surface area:

**Available in SDK:**
- ✅ `search` - universal, query, web, deep
- ✅ `sources` - create, list, resolve
- ✅ `oracle` - createJob, getJob, waitForJob, streamJob
- ✅ `daemon` - createSource, listSources, createE2ESession, getE2ESessionStatus, decryptE2EChunks

**NOT Available in SDK (require low-level access):**
- ❌ sources.get, sources.update, sources.delete
- ❌ contexts (all methods)
- ❌ tracer (all methods)
- ❌ filesystem (read, write, grep, tree, mkdir, mv, rm)
- ❌ packages.search
- ❌ dependencies (analyze, subscribe)
- ❌ advisor
- ❌ categories

### Remaining Tools Status

| Tool | SDK Support | Status |
|------|-------------|--------|
| nia_manage_resource | Partial (list only) | 🔶 Needs low-level for CRUD |
| source-resolver | Partial (resolve only) | 🔶 Needs low-level for full functionality |
| nia_tracer | ❌ None | 🔴 Requires low-level GithubSearchService |
| nia_context | ❌ None | 🔴 Requires low-level V2ApiContextsService |
| nia_advisor | ❌ None | 🔴 Requires low-level advisor service |
| nia_package_search | ❌ None | 🔴 Requires low-level V2ApiPackageSearchService |
| nia_auto_subscribe | ❌ None | 🔴 Requires low-level dependencies services |
| Filesystem tools | ❌ None | 🔴 Requires low-level filesystem services |
| nia_e2e | Partial | 🔶 Uses sdk.daemon where available |

### Recommendation

The SDK migration is **partially complete**. Three core tools (search, research, index) now have SDK paths, but many tools still require low-level service access that isn't exposed in the current SDK.

**Options for remaining tools:**
1. **Wait for SDK updates** - Nia may add more methods in future SDK versions
2. **Use low-level request methods** - If the SDK exposes a raw request method
3. **Keep legacy path** - Continue using NiaClient for tools without SDK support
4. **Hybrid approach** - Use SDK where available, legacy client where not

**Current state:** The plugin uses option 4 (hybrid) - SDK for migrated tools, legacy client for others.

### Verification

✅ **TypeScript:** All files compile without errors
✅ **Lint:** Biome passes with no issues
✅ **Tests:** 413 pass, 0 fail
✅ **Version:** 0.5.0-beta.0

### Next Steps

To complete Phase 3:
1. Add low-level service access to SDK adapter for remaining tools, OR
2. Accept partial SDK migration and document which tools use legacy vs SDK paths
3. Update README with NIA_USE_SDK documentation
4. Bump version to 0.5.0 (stable)
