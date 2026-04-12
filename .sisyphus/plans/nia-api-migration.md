# Nia API Migration & Bug Fix Plan

**Plugin:** `@vacbo/opencode-nia-plugin` v0.3.1
**Author:** Sisyphus (session-generated plan)
**Date:** 2026-04-12
**Scope:** Bring the opencode-nia-plugin up to date with Nia's current API (2026 spec), fix verified bugs, and migrate from a hand-rolled HTTP client to the official `nia-ai-ts` SDK.
**Prerequisites:** Phase 0 verification completed against `https://docs.trynia.ai/openapi-v2.yaml` on 2026-04-12.

---

## 1. Executive Summary

The plugin currently uses raw HTTP via a custom `NiaClient` (500 lines) with hand-written types (624 lines). Phase 0 verification against the authoritative OpenAPI v2 spec revealed **9 live bugs** and **4 deprecated endpoint families** that must change.

This plan proposes a phased migration:

1. **Phase 1 — Bug Fix Hotfix** (shippable alone): Fix all 9 verified bugs against the current `NiaClient`. Smallest possible diff, no SDK dependency, gets broken tools working for users immediately.
2. **Phase 2 — Unified Endpoint Migration**: Move `/search/{mode}` → `POST /search`, and all `/repositories`, `/data-sources`, `/research-papers` → `/sources` with type discriminator. Still on `NiaClient`.
3. **Phase 3 — SDK Adoption**: Introduce `nia-ai-ts`, wire it alongside `NiaClient` behind a feature flag, migrate tools one at a time.
4. **Phase 4 — Remove NiaClient**: Delete the hand-rolled client and types once all tools use the SDK.
5. **Phase 5 — New Capabilities** (**mandatory**, separate PRs): Expose sandbox search, feedback, usage, source annotations, document agent. User directive on 2026-04-12: Phase 5 is NOT optional — these capabilities must ship.

Phases 1 and 2 unblock users. Phases 3–4 reduce maintenance burden. Phase 5 adds net-new capabilities and is required (user directive, 2026-04-12) — the migration is not considered complete until Phase 5 ships.

---

## 2. Context

### 2.1 What the plugin does today
- 17 tool implementations under `src/tools/` registered through `@opencode-ai/plugin` SDK.
- Single `NiaClient` (`src/api/client.ts:48-500`) wraps `globalThis.fetch` with retry, timeout, and SSE parsing.
- Hand-written TypeScript types for every request/response shape (`src/api/types.ts`, 624 lines).
- Authentication via `NIA_API_KEY` env var → `Authorization: Bearer ${key}` header.
- Base URL: `https://apigcp.trynia.ai/v2` (configurable via `NIA_API_URL`).
- Background job tracking for oracle/tracer via `src/state/job-manager.ts` with SSE streaming and opencode client notifications.

### 2.2 What changed on the Nia side
Per the current OpenAPI v2 spec (fetched from `https://docs.trynia.ai/openapi-v2.yaml`):
- **Unified `POST /sources`** replaces `/repositories`, `/data-sources`, `/research-papers` — legacy endpoints are "deprecated and will be removed in a future version."
- **Unified `POST /search`** with `mode` discriminator (`query | web | deep | universal`) replaces `/search/{mode}` subpaths.
- **Official SDKs** released: `nia-ai-ts` (TypeScript/Node) and `nia-ai-py` (Python), both generated from the OpenAPI spec.
- **New capabilities**: sandbox search, document agent, extraction, vaults, shell docs, connectors, feedback, usage, source annotations, bulk delete.
- **Streaming endpoint convention**: SSE endpoints for oracle/tracer live at `/{resource}/{id}/stream`, not `/{resource}/{id}`.

### 2.3 Why act now
Four tools are **completely broken** today against the current API:
- `nia_package_search` — wrong URL + wrong registry enum
- `nia_auto_subscribe` — wrong URL
- `nia_tracer` (deep mode) — wrong URL
- Background job notifications — SSE hits JSON endpoints

Three more are partially broken:
- `nia_context` (update + search actions)
- `nia_read` (line ranges silently ignored)
- `nia_package_search` (3 of 4 registries)

And the entire indexing layer sits on deprecated endpoints that will stop working at an unannounced future date.

---

## 3. Goals & Non-Goals

### 3.1 Goals
1. **Restore functionality** for all currently-broken tools against Nia's current API.
2. **Eliminate deprecated endpoint usage** by moving to unified `/sources` and `/search`.
3. **Reduce long-term maintenance burden** by adopting the official SDK.
4. **Preserve all existing plugin behaviors**: tool schemas, config env vars, keyword triggers, job manager semantics, error classification, permission prompts.
5. **Ship incrementally** — each phase produces a mergeable PR.
6. **No regression** in unit/integration tests at any phase boundary.

### 3.2 Non-Goals
1. Refactoring plugin-side concerns unrelated to the Nia API (keyword triggers, config loader, formatting helpers).
2. Changing the public surface of any plugin tool. Agent-facing tool schemas stay the same unless a bug demands a rename.
3. Exposing new Nia capabilities (sandbox, document agent, etc.) — implemented in Phase 5, which is mandatory per user directive (2026-04-12).
4. Changing the installer CLI (`src/cli.ts`).
5. Migrating the legacy MCP integration path documented in `README.md`.
6. Writing new types for features we don't currently use.

### 3.3 Success Criteria
- Every tool that currently works keeps working (verified via existing integration tests).
- Every currently-broken tool produces correct responses against live Nia API (verified via new integration tests or manual smoke tests with a test API key).
- Plugin version bumped and released to npm.
- Zero deprecated endpoint references remain in `src/` after Phase 2.
- `src/api/client.ts` and most of `src/api/types.ts` deleted after Phase 4.

---

## 4. Phase 0 Findings (Verified Bugs)

All findings below are backed by direct comparison of plugin source code against the authoritative OpenAPI v2 spec fetched on 2026-04-12. Each finding cites file:line for the plugin side and the spec section for the API side.

### Bug #1 — `nia_read` sends `start_line`/`end_line`; API expects `line_start`/`line_end`
**Severity:** partial break (silent data loss)
**File:** `src/tools/nia-read.ts:71-72`
```typescript
if (args.line_start !== undefined) params.start_line = args.line_start;
if (args.line_end !== undefined)   params.end_line   = args.line_end;
```
**API:** `GET /fs/{source_id}/read?path=&line_start=&line_end=` (verified from `/api-reference/filesystem/read-file`)
**Effect:** Line range parameters are silently dropped. Users get the whole file back regardless.
**Fix:** Rename the outgoing query params (not the tool arg names) to `line_start`/`line_end`.

### Bug #2 — `nia_context` update uses PATCH; API requires PUT
**Severity:** complete break
**File:** `src/tools/nia-context.ts:171`
**API:** `put /contexts/{context_id}` — operationId `update_context_v2_v2_contexts__context_id__put`
**Effect:** `nia_context action=update` returns 405 Method Not Allowed.
**Fix:** Change `client.patch` to `client.put`.

### Bug #3 — `nia_context` search sends `query=`; API requires `q=`
**Severity:** complete break
**File:** `src/tools/nia-context.ts:142-144`
**API:** `GET /contexts/semantic-search?q=...` (required, minLength 1)
**Effect:** `nia_context action=search` returns 422 validation error.
**Fix:** Rename outgoing param from `query` to `q`. Keep tool arg name as `query` for backwards compatibility with existing agent usage.

### Bug #4 — `nia_tracer` deep mode POSTs to non-existent path
**Severity:** complete break
**File:** `src/tools/nia-tracer.ts:111-112`
```typescript
const response = (await client.post(
    "/github/tracer/jobs",
```
**API:** `POST /github/tracer` (single endpoint for both modes)
**Effect:** `tracer_mode=tracer-deep` returns 404/405.
**Fix:** Change URL to `/github/tracer`. Verify the `mode` field in request body distinguishes fast vs deep (currently set via `buildCreateBody`). Confirm from a live API response whether the single endpoint supports both modes or if deep mode has a different trigger.

### Bug #5 — SSE streaming hits non-streaming paths
**Severity:** complete break (for background notifications)
**File:** `src/state/job-manager.ts:64-66`
```typescript
const path = job.type === "oracle"
  ? `/oracle/jobs/${jobId}`
  : `/github/tracer/${jobId}`;
```
**API:**
- `GET /oracle/jobs/{job_id}/stream` — `stream_oracle_job_v2_oracle_jobs__job_id__stream_get`
- `GET /github/tracer/{job_id}/stream` — `stream_tracer_job_v2_github_tracer__job_id__stream_get`

**Effect:** The plugin sends `Accept: text/event-stream` to plain-JSON GET endpoints, then tries to parse a JSON response as SSE. Background oracle/tracer completion notifications (`[NIA ORACLE COMPLETE]`, `[NIA TRACER COMPLETE]`) never fire. Users see jobs that appear to hang forever.
**Fix:** Append `/stream` to both paths in `job-manager.ts:64-66`.

### Bug #6 — `nia_package_search` registry names don't match API enum
**Severity:** partial break (3 of 4 values wrong)
**File:** `src/tools/nia-package-search.ts:11, 63`
```typescript
const VALID_REGISTRIES = new Set<string>(["npm", "pypi", "crates", "go"]);
registry: tool.schema.enum(["npm", "pypi", "crates", "go"])
```
**API** (from `PackageSearchHybridRequest.registry`):
> `Registry: crates_io, golang_proxy, npm, py_pi, or ruby_gems`

**Plugin → API mapping needed:**
| Plugin arg | API value      |
| ---------- | -------------- |
| `npm`        | `npm`            |
| `pypi`       | `py_pi`          |
| `crates`     | `crates_io`      |
| `go`         | `golang_proxy`   |
| (add) `rubygems` | `ruby_gems`      |

**Effect:** Only `npm` works; other three return 422.
**Fix:** Keep the plugin arg names (agent-friendly), but translate to API values at call time.

### Bug #7 — `nia_package_search` uses removed URL
**Severity:** complete break
**File:** `src/tools/nia-package-search.ts:114`
**API:** `POST /packages/search` (URL moved from `/package-search/hybrid`; operationId still says `package_search_hybrid_v2_v2_packages_search_post` for backwards reference)
**Effect:** 404 regardless of registry.
**Fix:** Change URL to `/packages/search`.

### Bug #8 — `nia_auto_subscribe` hits generic `/dependencies` which doesn't exist
**Severity:** complete break
**File:** `src/tools/nia-auto-subscribe.ts:114`
**API:** three distinct endpoints:
- `POST /dependencies/analyze` — `DependencyAnalyzeRequest` (JSON) — preview only
- `POST /dependencies/subscribe` — `DependencySubscribeRequest` (JSON) — parse + subscribe
- `POST /dependencies/upload` — multipart file upload

**Effect:** 404.
**Fix:** Route based on `dry_run` flag:
- `dry_run=true` → `POST /dependencies/analyze`
- `dry_run=false` → `POST /dependencies/subscribe`
- (optional future) multipart upload path for direct file handling.

### Bug #9 — Tool schemas expose invalid `source_type` enum values
**Severity:** silent validation error when agent picks an invalid type

**Centralized definition:** `src/tools/source-resolver.ts:9-20` defines `VALID_SOURCE_TYPES` as the authoritative set. Every filesystem/source tool passes through `resolveSource()` which validates against this set. Fixing Bug #9 therefore requires changes to **both** the centralized resolver and the individual tool schemas that duplicate the enum.

**Files affected:**
- `src/tools/source-resolver.ts:9-20` — centralized `VALID_SOURCE_TYPES` set (contains `data_source`, `x`, `connector`).
- `src/tools/source-resolver.test.ts:60-76` — active test `it("resolves source_id with data_source type")` asserts the old behavior; must be updated to match the fix strategy (either removed or rewritten to assert the `data_source`→`documentation` shim).
- `src/tools/nia-read.ts:22-34` — tool schema enum.
- `src/tools/nia-grep.ts:22-33` — tool schema enum.
- Any other filesystem/source tool that redefines the enum locally (full audit required across `src/tools/*.ts`; likely includes `nia-write.ts`, `nia-rm.ts`, `nia-mv.ts`, `nia-mkdir.ts`, `nia-explore.ts`).

**Plugin enum (current):** `repository, data_source, documentation, research_paper, huggingface_dataset, local_folder, slack, google_drive, x, connector`
**API enum** (`SourceCreateRequest.type`, `Source.type`):
`repository, documentation, research_paper, huggingface_dataset, local_folder, slack, google_drive`

**Invalid values the plugin exposes:** `data_source`, `x`, `connector`
**Effect:** Agent may pick `data_source` (intuitive for doc sites) and hit 422 from `GET /sources?type=data_source`. `x` and `connector` are unsupported source types per current spec.

**Fix strategy:** the resolver shim is the single point that translates legacy values on the wire. Tool schemas must keep accepting `data_source` as valid input so that legacy agents (or stored system prompts) keep working — otherwise zod validation at the tool boundary would reject the request before the resolver ever runs. `x` and `connector` are dropped entirely because they never corresponded to real API source types.

**Concrete fix:**
- Update `src/tools/source-resolver.ts`:
  - Remove `x` and `connector` from `VALID_SOURCE_TYPES`.
  - Keep `data_source` in `VALID_SOURCE_TYPES` (needed so the resolver accepts it from tools).
  - Before issuing the `GET /sources` call, if `source_type === "data_source"`, rewrite to `"documentation"` and pass that as the `type` query param. The stored `type` on the returned `ResolvedSource` should also be `"documentation"` so downstream code never sees `data_source` again.
  - Emit a `NIA_DEBUG` log line noting the translation so agents get soft migration feedback.
- Update `src/tools/source-resolver.test.ts`:
  - Rewrite the `data_source` test case to assert the shim: input `source_type: "data_source"` results in a resolver call to `GET /sources?type=documentation` and a returned tuple `{ id, type: "documentation" }`.
  - Add new test cases asserting `source_type: "x"` and `source_type: "connector"` each return a `validation_error` string containing `unknown source_type`.
- Update every tool schema that duplicates the `source_type` enum:
  - Remove `x` and `connector`. Keep `data_source` (with a JSDoc comment `@deprecated: accepted for backwards compat; translated to documentation at the resolver layer`).
  - Add `documentation` to the enum so new callers can use the API-aligned value directly.
  - Resulting enum: `["repository", "data_source", "documentation", "research_paper", "huggingface_dataset", "local_folder", "slack", "google_drive"]`.
- **Decision required** (see §10 Q#4): if the user prefers a hard error instead of silent translation, remove `data_source` from both the resolver and the tool schemas and return a helpful `validation_error: "data_source is deprecated, use documentation"` message. The current plan assumes silent translation.

### Deprecated Endpoint Families (will be removed in future API version)

| Plugin path                                    | Replacement                               | Files                                       |
| ---------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| `POST /search/{universal,query,web,deep}`        | `POST /search` with `mode` discriminator    | `nia-search.ts:80`, `nia-research.ts:117,131`   |
| `POST /repositories`                             | `POST /sources` `{type:"repository",…}`     | `nia-index.ts:82`                             |
| `POST /data-sources`                             | `POST /sources` `{type:"documentation",…}`  | `nia-index.ts:101`                            |
| `POST /research-papers`                          | `POST /sources` `{type:"research_paper",…}` | `nia-index.ts:92`                             |
| `GET /repositories`                              | `GET /sources?type=repository`              | `nia-manage-resource.ts:168`                  |
| `GET /data-sources`                              | `GET /sources?type=documentation`           | `nia-manage-resource.ts:169`                  |
| `GET /{repositories\|data-sources\|research-papers}/{id}` | `GET /sources/{id}`                         | `nia-manage-resource.ts:183`, `ops-tracker.ts:115,119` |
| `PATCH /{...}/{id}`                              | `PATCH /sources/{id}`                       | `nia-manage-resource.ts:199`                  |
| `DELETE /{...}/{id}`                             | `DELETE /sources/{id}`                      | `nia-manage-resource.ts:226`                  |
| `POST /{...}/{id}/subscribe`                     | **No replacement** — returns client-side deprecation notice (see Phase 2 §"Note on `subscribe` action") | `nia-manage-resource.ts:240`                  |
<!-- table not formatted: invalid structure -->

### Resolved in subsequent verification (2026-04-12 via `llms-full.txt`)
- `nia_e2e` endpoints: confirmed at `/daemon/e2e/sessions`, `/daemon/e2e/sync`, `/daemon/e2e/decrypt`, `/daemon/e2e/sources/{id}/data`, `/daemon/e2e/sources/{id}/usage`. Plugin paths match. No action needed for the e2e tool in Phase 1/2.
- Subscribe endpoint under unified `/sources`: **does not exist**. Subscription is a legacy per-type concept with no unified replacement. Phase 2 handles this by returning a deprecation notice from the `subscribe` action (see §6 Phase 2).
- Filesystem paths (`/fs/{id}/{read,tree,grep,files,mv,mkdir}`): all confirmed in `llms-full.txt`. Plugin paths match.

---

## 5. Architecture Decisions

### 5.1 Bug fixes before SDK migration
**Decision:** Ship Phase 1 (bug fixes) before introducing the SDK.
**Rationale:** (a) Users have broken tools today; (b) bug-fix diff is small and reviewable; (c) fixing bugs first lets us compare before/after behavior when the SDK arrives, since both should produce the same results.
**Alternative considered:** Bundle bug fixes into the SDK migration. Rejected because it increases review surface and conflates two kinds of changes.

### 5.2 Keep plugin tool schemas stable
**Decision:** The names of tool arguments stay the same. Only wire-level payloads change. Examples:
- `nia_context action=search` keeps its `query` arg; we translate to `q` inside the tool.
- `nia_package_search` keeps `pypi`/`crates`/`go`; we translate to `py_pi`/`crates_io`/`golang_proxy`.
- `nia_read` keeps `line_start`/`line_end` arg names (which happen to already match the API).
**Rationale:** Zero-breakage for agents and users who already depend on the current tool interface. The opencode plugin manifest, keyword triggers, instructions file, and README don't need changes.

### 5.3 Use the TypeScript SDK for everything it supports
**Decision:** Phase 3 adopts `nia-ai-ts` with:
- **High-level clients** (`sdk.search.*`, `sdk.sources.*`, `sdk.oracle.*`) for the common paths.
- **Low-level generated services** (`V2ApiContextsService`, `V2ApiPackageSearchService`, `GithubSearchService`, etc.) for everything the high-level SDK doesn't cover (filesystem ops, tracer, context, package search, dependencies, advisor, e2e).
**Rationale:** The SDK is generated from the same OpenAPI spec we verified against, so it's guaranteed to have the right paths, param names, and types.
**Risk:** Low-level service class names are verbose. Mitigation: wrap in a thin internal adapter module (`src/api/nia-sdk.ts`) that presents a clean surface.

### 5.4 Feature flag during migration
**Decision:** Phase 3 introduces `NIA_USE_SDK` env var (default `false`). When enabled, tools route through the SDK; when disabled, they use the legacy `NiaClient`. Both paths must pass tests throughout Phase 3.
**Rationale:** Migration safety. Easy rollback if the SDK surfaces unexpected behavior.
**Removal:** Phase 4 removes the flag after we're confident.

### 5.5 Types: drop hand-written; adopt SDK types
**Decision:** Phase 3/4 deletes most of `src/api/types.ts` and imports types from `nia-ai-ts`. Plugin-internal types (job state, resolver return values, error classifications) stay in the plugin.
**Rationale:** Hand-written types drift from the API spec; generated types track the spec by construction.

### 5.6 SSE streaming: use SDK streams where available
**Decision:** Replace `client.stream()` and the manual SSE parser in `src/api/client.ts:110-208` with `sdk.oracle.streamJob()` for oracle jobs. For tracer jobs, use the equivalent low-level service stream method if present, or retain a small hand-rolled SSE helper that hits the *correct* `/stream` endpoints (bug-fixed version from Phase 1).
**Rationale:** Custom SSE parsing is fragile and duplicates work the SDK already does.

### 5.7 Error handling: wrap SDK errors in existing classifier
**Decision:** `src/utils/format.ts:classifyApiError` continues to produce the same user-facing error strings (`credits_exhausted`, `rate_limited`, etc.). We add a new branch that unwraps `NiaSDKError`, `NiaTimeoutError`, and `ApiError` into the existing taxonomy.
**Rationale:** Preserves the actionable-error-message UX documented in the README without forcing downstream code to learn SDK error types.

---

## 6. Implementation Phases

### Phase 1 — Bug Fix Hotfix

**Goal:** Fix all 9 verified bugs against the current `NiaClient`. No SDK changes. No deprecated-endpoint migrations.

**Scope (files changed):**

_Production code:_
- `src/tools/nia-read.ts` — rename outgoing query params (Bug #1)
- `src/tools/nia-context.ts` — PATCH → PUT, `query` → `q` (Bugs #2, #3)
- `src/tools/nia-tracer.ts` — `/github/tracer/jobs` → `/github/tracer` (Bug #4)
- `src/state/job-manager.ts` — append `/stream` to SSE paths (Bug #5)
- `src/tools/nia-package-search.ts` — URL fix + registry translation (Bugs #6, #7)
- `src/tools/nia-auto-subscribe.ts` — split `/dependencies` into `/dependencies/analyze` and `/dependencies/subscribe` based on `dry_run` (Bug #8)
- `src/tools/source-resolver.ts` — centralized source type fix + `data_source`→`documentation` shim (Bug #9)
- Every tool schema that duplicates the `source_type` enum: `src/tools/nia-grep.ts`, `src/tools/nia-write.ts`, `src/tools/nia-rm.ts`, `src/tools/nia-mv.ts`, `src/tools/nia-mkdir.ts`, `src/tools/nia-explore.ts`. Full audit required — if any other tool is found to duplicate the enum, add it to this list before starting work. (Bug #9)

_Test code (colocated updates to existing files):_
- `src/tools/nia-read.test.ts` — add `line_start`/`line_end` assertions (Bug #1)
- `src/tools/nia-context.test.ts` — add PUT + `q` assertions (Bugs #2, #3)
- `src/tools/nia-tracer.test.ts` — add `/github/tracer` deep-mode assertion (Bug #4)
- `src/state/job-manager.test.ts` — add `/stream` suffix assertion (Bug #5)
- `src/tools/nia-package-search.test.ts` — add URL + registry translation assertions (Bugs #6, #7)
- `src/tools/nia-auto-subscribe.test.ts` — add URL-routing assertion (Bug #8)
- `src/tools/source-resolver.test.ts` — rewrite `data_source` test case to assert the shim; add `x` / `connector` rejection tests (Bug #9)

_Integration test updates (existing files, must be edited in the same PR):_
- `tests/integration/auto-subscribe-tracer.test.ts:155-156` — change assertion `/v2/dependencies` → `/v2/dependencies/analyze` (because Bug #8 now routes `dry_run:"true"` to the analyze endpoint).
- `tests/integration/auto-subscribe-tracer.test.ts:198-206` — tighten assertion to only allow `/v2/github/tracer`; drop the OR-clause for the now-removed `/v2/github/tracer/jobs` path (Bug #4).

_New test files:_
- `src/tools/source-type-enum.test.ts` (**new**, colocated) — asserts every tool's `source_type` enum contains the expected set `["repository","data_source","documentation","research_paper","huggingface_dataset","local_folder","slack","google_drive"]` exactly (no `x`, no `connector`, `data_source` still present as a compat alias). Also asserts the resolver translates `data_source` → `documentation` on the wire.
- `tests/integration/bug-fixes.test.ts` (**new**, gated on `NIA_API_KEY`) — live-API smoke test per fixed tool. "Gated" means the test is skipped when `NIA_API_KEY` is unset; it is NOT outside Phase 1 scope. The file is part of the scope and must exist at merge time.

_Non-source files:_
- `package.json` — version bump to `0.3.2`

**Testing layout note:** This repo colocates unit tests next to source as `src/**/*.test.ts` and runs them via `bun test src/` (see `package.json` scripts `test:unit` and `lint`). Integration tests live under `tests/integration/` and run via `bun run test:integration`. Every file listed in the scope above (both updates and new files) is already accounted for in one of those two locations.

**Harness:** Phase 1 smoke tests run through the existing `tests/integration/real-api.test.ts` harness pattern — `NiaClient` with the request-logging `fetchFn` (lines 71-80), direct tool-factory invocation, and assertions on `requestLog` entries plus the returned string.

**Smoke test matrix (must all pass before merge):** every row below is executed via the harness above. One row per bug.

| Bug | Harness invocation                                                                                                                | Expected `requestLog` entry (method + path + key fields)                                  | Assertion on returned string                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| #1  | `nia_read({source_id:"<known-repo>", source_type:"repository", path:"README.md", line_start:1, line_end:20})`                       | `GET /v2/fs/<id>/read?path=README.md&line_start=1&line_end=20` (URL must contain `line_start=1` and `line_end=20`, NOT `start_line` or `end_line`) | Returned string contains exactly 20 lines of content (not the full file)                           |
| #2  | `nia_context({action:"save", title:"t", content:"<50-char content>"})` → capture `id` → `nia_context({action:"update", id, title:"renamed"})` | First call: `POST /v2/contexts`. Second call: `PUT /v2/contexts/<id>` (method is PUT, not PATCH)  | Second call returns a formatted context with `title: renamed`                                      |
| #3  | `nia_context({action:"search", query:"test"})`                                                                                      | `GET /v2/contexts/semantic-search?q=test` (query param name is `q`, NOT `query`)            | Returned string matches the list-format output and does not contain `validation_error`              |
| #4  | `nia_tracer({query:"streamText internals", repositories:["vercel/ai"], tracer_mode:"tracer-deep"})`                                 | `POST /v2/github/tracer` (single call, not `/v2/github/tracer/jobs`)                        | Returned string contains either a job id or an inline result; does NOT contain `404` or `405`        |
| #5  | `nia_research({mode:"oracle", query:"How does React use()?", repositories:"facebook/react"})` then await SSE completion            | Two requests appear: `POST /v2/oracle/jobs`, then `GET /v2/oracle/jobs/<id>/stream` (streaming URL must include `/stream` suffix) | Within 120s, `notifyComplete` is invoked on the opencode-client mock with `[NIA ORACLE COMPLETE]`    |
| #6  | `nia_package_search({registry:"pypi", package_name:"requests", semantic_queries:"retry"})`                                            | `POST /v2/packages/search` with body `{"registry":"py_pi", ...}` (plugin `pypi` translates to API `py_pi`) | Returned string contains `Found N result(s)` — NOT `validation_error`                                 |
| #6b | Repeat row #6 with `registry:"crates"` and `registry:"go"`                                                                           | Same URL, body `{"registry":"crates_io"}` and `{"registry":"golang_proxy"}` respectively     | Both return 200                                                                                    |
| #7  | `nia_package_search({registry:"npm", package_name:"ai", semantic_queries:"streaming"})`                                              | `POST /v2/packages/search` (URL is `/packages/search`, NOT `/package-search/hybrid`)          | Returned string contains `Found N result(s)`                                                       |
| #8  | `nia_auto_subscribe({manifest_content:"{\"dependencies\":{\"react\":\"^18\"}}", manifest_type:"package.json", dry_run:"true"})`        | `POST /v2/dependencies/analyze` (NOT `/v2/dependencies`)                                    | Returned string contains `Dry run`                                                                 |
| #8b | Repeat row #8 with `dry_run:"false"` (permission pre-granted in test harness)                                                       | `POST /v2/dependencies/subscribe`                                                         | Returned string contains `Subscribed`                                                              |
| #9  | `nia_read({source_type:"data_source", identifier:"example.com", path:"/"})`                                                           | `GET /v2/sources?type=documentation&query=example.com&limit=1` (shim translates `data_source`→`documentation`) | Returned string is not a `validation_error`; resolver returned a valid source id with `type:"documentation"` |
| #9b | `nia_read({source_type:"x", identifier:"anything", path:"/"})`                                                                        | No HTTP request (zod schema rejects `x` at tool boundary)                                   | Returned string starts with `validation_error` or zod-thrown error mentioning invalid enum value      |
| #9c | Static: grep each tool file for the removed values                                                                                | —                                                                                         | `rg -n '"x"\|"connector"' src/tools/*.ts --glob '!*.test.ts'` returns zero hits under a `source_type` enum context; `rg -n '"data_source"' src/tools/*.ts --glob '!*.test.ts'` still finds entries (compat alias is intentional) |
<!-- table not formatted: invalid structure -->

**Verification gates (must pass before merge):**
- [ ] `bun test src/` — all unit tests pass
- [ ] `bun run typecheck` — no TypeScript errors
- [ ] `bun run lint` — biome passes
- [ ] `bun run test:integration` — all existing integration tests pass (including the updated `auto-subscribe-tracer.test.ts`)
- [ ] Every row in the Phase 1 smoke test matrix above passes; results captured in the PR description

**Acceptance criteria:**
1. Every bug from §4 is addressed with a targeted fix and a test that would have caught it.
2. No changes to files outside the listed scope. The listed scope includes `package.json` for the version bump. Any other file touched requires a plan amendment.
3. Plugin version in `package.json` bumped to `0.3.2`.
4. PR description enumerates each bug fix with a one-line "before/after" description (repo has no `CHANGELOG.md` today).
5. No deprecated endpoint paths removed in this phase — that's Phase 2.
6. All pre-existing tests continue to pass.
7. `bun run typecheck` and `bun run lint` exit clean (these run against `src/`, which is where all new/updated tests live).

**Estimated effort:** 1–2 days.
**Risk level:** low. Each fix is a targeted one/two-line change with a test.

---

### Phase 2 — Unified Endpoint Migration

**Goal:** Move away from deprecated `/repositories`, `/data-sources`, `/research-papers`, `/search/{mode}` to unified `/sources` and `POST /search` (still on `NiaClient`, no SDK yet).

**Scope (files changed):**

_Production code:_
- `src/tools/nia-search.ts` — collapse four endpoint paths into one `POST /search` with `mode` in body.
- `src/tools/nia-research.ts` — update web/deep search callsites.
- `src/tools/nia-index.ts` — replace `/repositories`, `/data-sources`, `/research-papers` POSTs with `POST /sources` + `type` discriminator.
- `src/tools/nia-manage-resource.ts` — replace per-type CRUD paths with `/sources/{id}` CRUD; update the `list` action to call `GET /sources?type=repository` and `GET /sources?type=documentation` in parallel (preserving the returned shape). Tool arg schemas unchanged.
- `src/state/ops-tracker.ts:115,119` — status polling uses `GET /sources/{id}` regardless of type.
- `src/api/types.ts` — update request/response types to match unified schemas (`SourceCreateRequest`, `Source`, `SourceListResponse`, `QuerySearchRequest`, etc.).
- `src/tools/source-resolver.ts` — already updated in Phase 1 (Bug #9); Phase 2 just verifies no regression from the unified-endpoint changes.

_Test code (colocated updates to existing files):_
- `src/tools/nia-index.test.ts` — add assertions that `POST /sources` is called with the correct `type` discriminator for each source kind and that the body matches `SourceCreateRequest`.
- `src/tools/nia-search.test.ts` — add assertions for a single POST to `/search` with the correct `mode` discriminator for universal/query/web/deep.
- `src/tools/nia-research.test.ts` — same pattern for web and deep modes.
- `src/tools/nia-manage-resource.test.ts` — assert unified `/sources/{id}` paths for list/status/rename/delete actions; assert `subscribe` returns the deprecation notice and makes zero HTTP requests; assert the `data_source`→`documentation` shim on the wire.
- `src/state/ops-tracker.test.ts` — assert the unified polling endpoint is used for repositories, documentation, and research papers.

_Integration test updates (existing files, must be edited in the same PR):_
- `tests/integration/real-api.test.ts`:
  - Line 153: replace `client.get<DataSourceRecord[]>("/data-sources")` with `client.get<SourceListResponse>("/sources", { type: "documentation" })` and update the response destructuring accordingly.
  - Line 159: update the error-message string to reference `/sources?type=documentation`.
  - Line 171: replace `/data-sources/${id}` with `/sources/${id}`.
  - Line 196: replace `DELETE /data-sources/${id}` with `DELETE /sources/${id}`.
  - Lines 227, 245: change `expectSuccessfulCall(..., "/v2/search/web")` to `expectSuccessfulCall(..., "/v2/search")` (the unified endpoint).
  - Lines 258, 259: change assertions from `/v2/repositories` + `/v2/data-sources` to two `/v2/sources` assertions with the `type` query filter.
  - Line 293: change `/v2/data-sources` → `/v2/sources`.
  - Line 316: change `/v2/data-sources/${indexed.source_id}` → `/v2/sources/${indexed.source_id}`.
- `tests/integration/read-grep-explore.test.ts:131` — replace `client.get<RepoRecord[]>("/repositories")` with `client.get<SourceListResponse>("/sources", { type: "repository" })` and adapt the return-type handling.
- `tests/integration/plugin-lifecycle.test.ts`:
  - Lines 165, 205: change mock handler + expected path from `/v2/search/universal` to `/v2/search` (and the mock must match on the `mode:"universal"` body discriminator instead of the URL suffix).
  - Lines 169, 210: change `/v2/repositories` to `/v2/sources?type=repository`.
  - Lines 173, 215: change `/v2/repositories/repo_1` to `/v2/sources/repo_1`.

_New test files:_
- `tests/integration/unified-endpoints.test.ts` (**new**, gated on `NIA_API_KEY`) — live-API validation for every smoke-matrix row in Phase 2. "Gated" means the test is skipped when `NIA_API_KEY` is unset; it is NOT outside Phase 2 scope, the file must exist and be committed.

_Non-source files:_
- `package.json` — version bump to `0.4.0`.

**Verification gates:**
- Same as Phase 1 (typecheck, lint, tests): `bun test src/`, `bun run typecheck`, `bun run lint`.
- Additional grep gate: zero hits in `src/` (production code only, excluding `*.test.ts`) for: `/repositories`, `/data-sources`, `/research-papers`, `/search/universal`, `/search/query`, `/search/web`, `/search/deep`. If any `.test.ts` file still references these, it's because the test asserts the old shape and needs updating too.

**Schema stability note:** The `nia_manage_resource` tool currently exposes `action`, `resource_type` (`repository|data_source|research_paper|category`), `resource_id`, `name`, and `description` (see `src/tools/nia-manage-resource.ts:125-149`). Per §3.2, Phase 2 does NOT change these tool arg names. The plugin-internal value `data_source` continues to be accepted from agents but maps to `type=documentation` on the wire (same shim pattern as Bug #9). The `list` action currently calls `/repositories` and `/data-sources` in parallel without filtering or pagination (lines 166-176); Phase 2 preserves that surface by issuing two `GET /sources?type=repository` and `GET /sources?type=documentation` calls in parallel and merging the result shape the tool returns today.

**Harness:** Phase 2 smoke tests run through the existing integration-test harness at `tests/integration/real-api.test.ts` (see the fetch-logging pattern at lines 71-80). New smoke tests extend that pattern: construct `NiaClient` with the request-logging `fetchFn`, instantiate each tool factory directly, invoke `execute()` with the fixed input, and assert on (a) the recorded request log path/method and (b) the returned string's content. This is the same harness every integration test in this repo already uses. No external CLI is needed.

**Smoke test matrix (must all pass before merge):** every row below is executed via the harness above. Each row asserts the wire-level request path/method and the shape of the returned response.

| # | Harness invocation                                                                                                | Expected HTTP request                                                                | Assertion                                                                              |
| - | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1 | `nia_index({url:"https://github.com/nozomio-labs/nia-opencode"})`                                                   | `POST /sources` body `{type:"repository", repository:"nozomio-labs/nia-opencode"}`     | `requestLog` contains `POST /sources`; returned string references a non-empty `id`       |
| 2 | `nia_index({url:"https://example.com", crawl_entire_domain:"true"})`                                                | `POST /sources` body `{type:"documentation", url:"...", crawl_entire_domain:true}`     | `requestLog` contains `POST /sources`; returned string references a non-empty `id`       |
| 3 | `nia_index({url:"https://arxiv.org/abs/2301.00001"})`                                                               | `POST /sources` body `{type:"research_paper", url:"..."}`                               | `requestLog` contains `POST /sources`                                                     |
| 4 | `nia_search({query:"retry logic", num_results:5})` (default `search_mode:"universal"`)                              | Single `POST /search` with body `mode:"universal"`, `query`, `top_k`                       | `requestLog` contains `POST /search` (not `/search/universal`); non-empty `sources` array  |
| 5 | `nia_search({query:"retry logic", search_mode:"query"})`                                                             | Single `POST /search` with body `mode:"query"`                                             | `requestLog` contains exactly one `POST /search`                                            |
| 6 | `nia_research({mode:"quick", query:"latest LLM developments"})`                                                     | `POST /search` with body `mode:"web"`, `query`                                             | `requestLog` contains `POST /search`                                                        |
| 7 | `nia_research({mode:"deep", query:"Compare RSC vs SSR"})`                                                           | `POST /search` with body `mode:"deep"`, `query`                                            | `requestLog` contains `POST /search`                                                        |
| 8 | `nia_manage_resource({action:"list"})` (no filters — current surface)                                               | Two parallel calls: `GET /sources?type=repository` and `GET /sources?type=documentation`   | `requestLog` contains both; returned JSON has both `repositories` and `data_sources` keys (legacy wrapper preserved) |
| 9 | `nia_manage_resource({action:"status", resource_type:"repository", resource_id:"<id>"})`                              | `GET /sources/<id>` (not `/repositories/<id>`)                                             | `requestLog` entry has path `/sources/<id>`                                                 |
| 10 | `nia_manage_resource({action:"status", resource_type:"data_source", resource_id:"<id>"})`                            | `GET /sources/<id>` (shim translates `data_source`)                                      | `requestLog` entry has path `/sources/<id>`                                                 |
| 11 | `nia_manage_resource({action:"rename", resource_type:"repository", resource_id:"<id>", name:"new name"})`            | `PATCH /sources/<id>` with body matching `SourceUpdateRequest`                            | `requestLog` entry has method `PATCH` and path `/sources/<id>`                              |
| 12 | `nia_manage_resource({action:"delete", resource_type:"repository", resource_id:"<id>"})` (with permission granted) | `DELETE /sources/<id>`                                                                 | `requestLog` entry has method `DELETE` and path `/sources/<id>`                             |
| 13 | Trigger `ops-tracker` polling for an in-progress source via the existing status endpoint                           | `GET /sources/<id>` (regardless of original resource type)                             | `requestLog` entries all target `/sources/<id>`                                              |
| 14 | Grep production code for deprecated paths                                                                         | `rg -n '/(repositories\|data-sources\|research-papers\|search/(universal\|query\|web\|deep))' src/ --glob '!*.test.ts'` | Exit 1 (zero hits)                                                                      |
<!-- table not formatted: invalid structure -->

**Note on `subscribe` action:** A full scan of `https://docs.trynia.ai/llms-full.txt` (fetched 2026-04-12) confirmed that **the unified API exposes no replacement for the legacy `POST /{repositories|data-sources|research-papers}/{id}/subscribe` endpoint.** Subscription was a per-type legacy concept; the unified `/sources` resource offers `POST/GET/DELETE /sources` and `GET /sources/{id}` but no `/subscribe` sub-resource.

Phase 2 handles this as follows:
- The `nia_manage_resource action=subscribe` handler in `src/tools/nia-manage-resource.ts` is updated to return a clear deprecation notice instead of making an API call: `"deprecated: the unified Nia API no longer supports per-source subscription. Use category organization or the dependencies endpoints instead."` No HTTP request is issued.
- The `subscribe` action value stays in the tool arg enum (schema stability per §3.2) but its behavior becomes "return deprecation message."
- Existing tests that exercise `subscribe` are updated to assert the deprecation message and zero `requestLog` entries.
- If a future unified subscribe endpoint ships, a follow-up PR restores the behavior — that is outside Phase 2 scope.

**Acceptance criteria:**
1. Every tool-invocation row in the smoke test matrix above (rows 1–13) passes. PR description includes the captured request log and returned-string excerpt for each row.
2. Row 14 (grep gate) returns zero hits.
3. `nia_manage_resource action=subscribe` returns the deprecation notice without making any HTTP request (asserted by the updated `src/tools/nia-manage-resource.test.ts`).
4. Zero references to deprecated endpoint paths remain in `src/**/*.ts` production code (restated for emphasis; enforced by row 14).
5. All existing unit tests and integration tests pass (including the three integration files updated in scope).
6. New/updated tests cover each migrated endpoint.
7. No changes to tool arg schemas (agent-facing surface unchanged).
8. Plugin version in `package.json` bumped to `0.4.0` (minor bump — internal change, no user-visible API break, but non-trivial scope).
9. No files changed outside the Phase 2 scope list above.

**Estimated effort:** 2–3 days.
**Risk level:** medium. Scope is broader than Phase 1 but each individual change is mechanical.

---

### Phase 3 — SDK Adoption (Parallel)

**Goal:** Introduce `nia-ai-ts` as a dependency, create an adapter layer, and migrate tools one at a time behind a feature flag.

**Scope (files changed across the full phase):**

_Production code (added once at the start of Phase 3):_
- `src/api/nia-sdk.ts` (**new**) — thin adapter that constructs `NiaSDK` + low-level services and exposes a clean internal surface. Absorbs the verbose auto-generated service names.
- `src/config.ts` — add `NIA_USE_SDK` env var (default `false`).
- `src/index.ts` — conditionally construct `NiaClient` or `NiaSDK`-backed adapter based on the flag; pass the chosen adapter to each tool factory.

_Production code (touched one file per sub-step):_
- Each tool's source file in `src/tools/` plus supporting state files (`src/state/job-manager.ts`) — migrated in the order listed below. One file per sub-step PR.

_Test code (colocated updates, added once at the start of Phase 3):_
- Every existing colocated test under `src/tools/*.test.ts` and `src/state/*.test.ts` — extended to run the same assertions under both `NIA_USE_SDK=false` and `NIA_USE_SDK=true`. The repo convention is to describe both modes in one file via a `.each([false, true])` pattern.

_New integration test files (one per tool, added during the sub-step that migrates that tool):_
- `tests/integration/sdk-migration-nia-search.test.ts`
- `tests/integration/sdk-migration-nia-research.test.ts`
- `tests/integration/sdk-migration-nia-index.test.ts`
- `tests/integration/sdk-migration-nia-manage-resource.test.ts`
- `tests/integration/sdk-migration-source-resolver.test.ts`
- `tests/integration/sdk-migration-nia-tracer.test.ts`
- `tests/integration/sdk-migration-nia-context.test.ts`
- `tests/integration/sdk-migration-nia-advisor.test.ts`
- `tests/integration/sdk-migration-nia-package-search.test.ts`
- `tests/integration/sdk-migration-nia-auto-subscribe.test.ts`
- `tests/integration/sdk-migration-nia-read.test.ts`
- `tests/integration/sdk-migration-nia-grep.test.ts`
- `tests/integration/sdk-migration-nia-explore.test.ts`
- `tests/integration/sdk-migration-filesystem-mutations.test.ts` (covers `nia_write`, `nia_mv`, `nia_mkdir`, `nia_rm` round-trip)
- `tests/integration/sdk-migration-nia-e2e.test.ts`
- `tests/integration/sdk-migration-job-manager.test.ts` (covers oracle + tracer streaming)

Each file runs the same harness pattern as `tests/integration/real-api.test.ts` but toggles `NIA_USE_SDK` between runs and asserts behavior parity.

_Documentation:_
- `README.md` — add the `NIA_USE_SDK` flag to the config reference table.

_Non-source files:_
- `package.json` — add `nia-ai-ts` dependency (exact version pinned) and bump plugin version to `0.5.0-beta.0`. Each sub-step may push further `-beta.N` bumps during the migration.

Each sub-step is a separate PR or commit with its own test updates and a clean rollback story (revert the sub-step commit).

**Migration order** (lowest risk first):
1. `nia_search` → `sdk.search.{universal,query,web,deep}`
2. `nia_research` (web/deep modes) → `sdk.search.{web,deep}`
3. `nia_research` (oracle) → `sdk.oracle.{createJob, waitForJob, streamJob}` — note: this also replaces the custom SSE parser for oracle
4. `nia_index` → `sdk.sources.create`
5. `nia_manage_resource` → `sdk.sources.{list,resolve,delete}` for common ops; low-level for patch; `subscribe` action remains a client-side deprecation notice (no SDK call), carried over from Phase 2
6. `source-resolver.ts` → `sdk.sources.list`
7. `nia_tracer` → low-level `GithubSearchService.createTracerJobV2GithubTracerPost` + stream method
8. `nia_context` → low-level `V2ApiContextsService.*`
9. `nia_advisor` → low-level advisor service
10. `nia_package_search` → low-level `V2ApiPackageSearchService`
11. `nia_auto_subscribe` → low-level dependencies services (analyze + subscribe)
12. Filesystem tools (`nia_read`, `nia_write`, `nia_grep`, `nia_explore`, `nia_mv`, `nia_mkdir`, `nia_rm`) → low-level filesystem services
13. `nia_e2e` → `sdk.daemon.*` methods if exposed; low-level otherwise
14. `src/state/job-manager.ts` → use SDK streams for oracle; adapt tracer streaming

**Test changes per tool migration:**
The existing colocated test file for each tool (`src/tools/<tool>.test.ts` or `src/state/<module>.test.ts`) is extended to run both the `NiaClient` and `NiaSDK` paths, asserting identical behavior. New tests go in the same colocated location so they're picked up by `bun test src/`. Test doubles use the SDK's error classes (`NiaSDKError`, `NiaTimeoutError`, `ApiError`).

**Harness:** Phase 3 smoke tests extend the existing integration-test harness at `tests/integration/real-api.test.ts` — the same `NiaClient` + request-logging `fetchFn` + direct tool-factory invocation pattern already used by the repo (see §`tests/integration/real-api.test.ts:49-80` for the existing `LIVE_CONFIG` and `fetchFn` setup). Do NOT invent a new CLI. Each tool gets a new test file `tests/integration/sdk-migration-<tool>.test.ts` that runs the tool factory twice: once with a `NiaClient`-backed adapter, once with a `NiaSDK`-backed adapter (via `NIA_USE_SDK=true`).

**Smoke test matrix (per migrated tool, run before merging that tool's sub-step):**

For every tool in the migration order, execute both the legacy and SDK paths back-to-back and compare results. Concrete steps:

1. **Run the tool's colocated unit tests in both modes:**
   ```bash
   NIA_USE_SDK=false bun test src/tools/<tool>.test.ts
   NIA_USE_SDK=true  bun test src/tools/<tool>.test.ts
   ```
   Both must pass.
2. **Run the per-tool integration test in both modes:**
   ```bash
   NIA_USE_SDK=false NIA_API_KEY=<test_key> bun test tests/integration/sdk-migration-<tool>.test.ts
   NIA_USE_SDK=true  NIA_API_KEY=<test_key> bun test tests/integration/sdk-migration-<tool>.test.ts
   ```
   The test file invokes the tool factory's `execute()` with the fixed input from the table below and asserts (a) `requestLog` shows the expected path/method and (b) the returned string contains the expected top-level field name. The test runs once per mode and diffs the two returned strings; they must match except for timestamps and IDs.
3. **Bundle size check:**
   ```bash
   bun run build && du -sh dist/
   ```
   Net size change must be negative or within 5% of the baseline captured at the start of Phase 3 (SDK adds some weight but we delete custom types/client per step).

**Per-tool fixed smoke inputs (used in step 2 above):**

Only agent-callable tools appear here. Internal modules (`source-resolver.ts`, `job-manager.ts`) are exercised indirectly through the tools that use them — see §"Internal module coverage" below the table.

| Tool                   | Fixed input (passed to `tool.execute()`)                                                            | Expected `requestLog` entry           | Expected returned-string field |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------ |
| `nia_search`             | `{query:"retry logic", num_results:5, search_mode:"universal"}`                                        | `POST /search`                          | `sources` (array)                |
| `nia_research` (quick)   | `{mode:"quick", query:"latest LLM developments"}` (plugin `quick` → API `mode:"web"`)                   | `POST /search`                          | `results` (array)                |
| `nia_research` (deep)    | `{mode:"deep", query:"Compare RSC vs SSR"}` (plugin `deep` → API `mode:"deep"`)                         | `POST /search`                          | `result` (string)                |
| `nia_research` (oracle)  | `{mode:"oracle", query:"How does React caching work?", repositories:"vercel/next.js"}`                | `POST /oracle/jobs`                     | `job_id`; SSE completion arrives |
| `nia_index`              | `{url:"https://github.com/nozomio-labs/nia-opencode"}`                                                | `POST /sources`                         | `id` (string)                    |
| `nia_manage_resource`    | `{action:"list"}`                                                                                     | Two `GET /sources?type=…` entries         | `repositories` and `data_sources` keys |
| `nia_tracer`             | `{query:"How does streamText work?", repositories:["vercel/ai"], tracer_mode:"tracer-fast"}`          | `POST /github/tracer`                   | `result` or `results`              |
| `nia_context` (save)     | `{action:"save", title:"test", content:"<50-char test content>"}`                                     | `POST /contexts`                        | `id` (string)                    |
| `nia_context` (retrieve) | `{action:"retrieve", id:"<id from save>"}`                                                            | `GET /contexts/<id>`                    | Title match                      |
| `nia_context` (update)   | `{action:"update", id:"<id>", title:"renamed"}`                                                       | `PUT /contexts/<id>`                    | Updated title                    |
| `nia_advisor`            | `{query:"How to handle errors in fetch?"}`                                                            | `POST /advisor`                         | `advice` (string)                |
| `nia_package_search`     | `{registry:"npm", package_name:"ai", semantic_queries:"streaming"}`                                   | `POST /packages/search`                 | `results` (array)                |
| `nia_auto_subscribe`     | `{manifest_content:"{\"dependencies\":{}}", manifest_type:"package.json", dry_run:"true"}`              | `POST /dependencies/analyze`            | `dependencies` (array)           |
| `nia_read`               | `{source_id:"<known>", source_type:"repository", path:"README.md", line_start:1, line_end:20}`          | `GET /fs/<id>/read?…&line_start=1&line_end=20` | `content` (string, ≤20 lines)    |
| `nia_grep`               | `{source_id:"<known>", source_type:"repository", pattern:"export"}`                                    | `POST /fs/<id>/grep`                     | Non-empty match array          |
| `nia_explore`            | `{source_id:"<known>", source_type:"repository"}`                                                      | `GET /fs/<id>/tree`                      | Tree node array                |
| `nia_write` / `nia_mv` / `nia_mkdir` / `nia_rm` | Round-trip on a test-owned source: mkdir → write → read → mv → rm                                   | Sequence of `/fs/<id>/…` entries         | Each call returns 200           |
| `nia_e2e`                | `{action:"create_session", local_folder_id:"<known>"}` then `get_session` then `purge`                 | `POST /daemon/e2e/sessions` etc.        | `session_id` + `expires_at`       |
<!-- table not formatted: invalid structure -->

**Internal module coverage** (not agent-callable, covered indirectly):

| Module                     | How its SDK path is verified                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/source-resolver.ts` | Exercised by every tool that uses `resolveSource()`. When `nia_read`, `nia_grep`, etc. run via the harness above with `source_type + identifier`, the resolver's `GET /sources?type=…&query=…` call appears in `requestLog`. Assert that entry exists. Additionally, `src/tools/source-resolver.test.ts` runs in both modes. |
| `src/state/job-manager.ts`   | Exercised by `nia_research` (oracle) and `nia_tracer` (deep). The test waits up to 120s for the SSE completion event, then asserts the appropriate `[NIA ORACLE COMPLETE]` or `[NIA TRACER COMPLETE]` notification was queued through the opencode client mock. Colocated unit test `src/state/job-manager.test.ts` runs in both modes. |
<!-- table not formatted: invalid structure -->

**Verification gates:**
- Every merged sub-step must pass both test suites (`NIA_USE_SDK=false` and `NIA_USE_SDK=true`) on that tool's colocated test file.
- Smoke matrix above for the migrated tool must pass in both modes.
- Bundle size check passes.
- Integration tests against live API must pass in both modes.

**Acceptance criteria:**
1. Every tool has two paths, both tested.
2. Documented `NIA_USE_SDK` flag added to `README.md`.
3. Each migration step is a separate PR or commit with a clean rollback story (revert the sub-step commit).
4. No new bugs introduced (integration tests pass throughout).
5. Every file listed in the Phase 3 scope above is the only set of files modified during Phase 3. Files outside the scope (production code, test files, README, package.json) are not touched.
6. Plugin version bumped to `0.5.0` when all tools have SDK paths. Interim versions during migration use `0.5.0-beta.N`.

**Estimated effort:** 4–6 days (spread across multiple small PRs).
**Risk level:** medium. Mitigated by the feature flag — we can disable SDK path at any time.

---

### Phase 4 — Remove NiaClient

**Goal:** Delete the hand-rolled HTTP client once Phase 3 is validated.

**Scope:**
- Delete `src/api/client.ts` and `src/api/client.test.ts`.
- Delete most of `src/api/types.ts`; keep only plugin-internal types (job state, resolver return values, error classifications).
- Remove `NIA_USE_SDK` flag and the dual-path branches in each tool factory.
- Update `src/utils/format.ts:classifyApiError` to remove `NiaClient`-specific error parsing; keep the user-facing error taxonomy.
- Update `README.md` configuration sections to remove `NIA_USE_SDK`.
- Drop any test doubles that target `NiaClient` directly.
- `package.json` — version bump to `0.5.1` (or `0.6.0` if any user-visible behavior actually changed during Phases 3–4).

**Smoke test matrix (must all pass before merge):**

| # | Check                                                                                    | Command / action                                                              | Expected result                                                       |
| - | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1 | No references to `NiaClient` or its types remain                                             | `rg -n 'NiaClient\|api/client' src/`                                              | Zero hits                                                             |
| 2 | No references to `NIA_USE_SDK` remain                                                        | `rg -n 'NIA_USE_SDK' src/ README.md`                                              | Zero hits                                                             |
| 3 | `src/api/client.ts` deleted                                                                | `ls src/api/client.ts`                                                          | "No such file"                                                        |
| 4 | `src/api/client.test.ts` deleted                                                           | `ls src/api/client.test.ts`                                                     | "No such file"                                                        |
| 5 | Typecheck                                                                                | `bun run typecheck`                                                             | Exit 0                                                                |
| 6 | Lint                                                                                     | `bun run lint`                                                                  | Exit 0                                                                |
| 7 | Unit tests                                                                               | `bun test src/`                                                                 | All pass                                                              |
| 8 | Integration tests                                                                        | `bun run test:integration` (with `NIA_API_KEY` set)                             | All pass                                                              |
| 9 | Bundle size                                                                              | `du -sh dist/` compared to v0.4.0 baseline                                      | Net decrease (target: 20%+ smaller than v0.4.0)                       |
| 10 | Full-tool smoke run                                                                      | Run every tool with its fixed smoke input from Phase 3 matrix                   | Each returns 2xx and a response matching its documented shape         |
| 11 | No dead imports                                                                          | `bun run typecheck` (catches unused imports via strict config)                  | Exit 0                                                                |
<!-- table not formatted: invalid structure -->

**Verification gates:** all 11 rows above.

**Acceptance criteria:**
1. `NiaClient` class no longer exists in `src/` (row 1, 3).
2. `src/api/types.ts` is under 100 lines (plugin-internal types only) or deleted if empty.
3. All tools import from `src/api/nia-sdk.ts` (the adapter).
4. `NIA_USE_SDK` env var removed from `src/config.ts` and `README.md` (row 2).
5. Plugin version bumped to `0.5.1` or `0.6.0` depending on whether any external behavior changed.
6. Bundle size reduced compared to v0.4.0 baseline (row 9).

**Estimated effort:** 1 day.
**Risk level:** low (all heavy lifting done in Phase 3).

---

### Phase 5 — New Capabilities (Mandatory, Separate PRs)

**Goal:** Expose Nia features that weren't previously available. Each capability ships as its own PR.

**Status:** MANDATORY per user directive on 2026-04-12. This phase was originally drafted as optional; that status has been revoked. Phase 5 must ship for the migration to be considered complete. Every capability in the candidate list below is in scope unless explicitly removed by a plan amendment signed off by the user.

**Required features** (ordered by rollout priority — each ships as its own PR; all six must land before Phase 5 is complete):
1. **`nia_sandbox`** — wraps `POST /sandbox/search` for ephemeral clone + read-only agent against public repos. Big win for opencode users who want quick lookups without indexing. Also wraps `GET /sandbox/jobs/{jobId}` for job polling and supports SSE streaming.
2. **`nia_usage`** — wraps `GET /usage` for quota reporting. Trivial to implement, useful for cost-conscious users.
3. **`nia_document_agent`** — wraps `POST /document/agent` (sync) plus the async job surface (`POST /document/agent/jobs`, `GET /document/agent/jobs/{job_id}`, `GET /document/agent/jobs/{job_id}/stream`, `DELETE /document/agent/jobs/{job_id}`) for AI-powered PDF analysis with citations. Pairs with existing `nia_index` for PDFs.
4. **Feedback hooks** — a new `nia_feedback` tool exposing `POST /feedback/answer`, `POST /feedback/source`, and `POST /feedback/interaction`. Opencode agents call it after `nia_search` / `nia_research` to submit thumbs up/down and implicit interaction signals.
5. **Source annotations** — extend `nia_manage_resource` (or add a dedicated `nia_annotations` tool) to support `POST/GET/DELETE /sources/{id}/annotations` so the agent can leave notes on indexed sources.
6. **Bulk delete** — new action in `nia_manage_resource` that uses the unified bulk-delete endpoint (verify exact path against `llms-full.txt` during implementation: likely `POST /sources/bulk-delete` or the existing `POST /bulk-delete`) for efficient multi-source cleanup.

**Each required feature delivers:**
- New tool file under `src/tools/` (or a new action on an existing tool where noted above).
- Tool schema + handler.
- Colocated unit tests at `src/tools/<new-tool>.test.ts`.
- Live API integration test at `tests/integration/<new-tool>.test.ts`, gated on `NIA_API_KEY` (the gate controls CI skip behavior only — the file itself is mandatory scope).
- README update: new row in the available-tools table.
- Config flag (`NIA_SANDBOX`, `NIA_USAGE`, `NIA_DOCUMENT_AGENT`, `NIA_FEEDBACK`, `NIA_ANNOTATIONS`, `NIA_BULK_DELETE`) defaulting to enabled, wired through `src/config.ts`.
- `package.json` version bump (minor) per feature.

**Per-feature smoke test template:**

Every Phase 5 PR must include, in the PR description, a smoke test table of this shape:

| # | Invocation | Expected HTTP request | Expected response | Pass? |
| - | ---------- | --------------------- | ----------------- | ----- |

**Harness:** Phase 4 has already deleted `NiaClient`, so Phase 5 feature PRs must use the SDK-backed adapter (`src/api/nia-sdk.ts`) that was introduced in Phase 3 and became the sole HTTP surface in Phase 4. Each new tool factory takes the adapter, not `NiaClient`. For test harnessing, construct a mock `NiaSDK` (via `vi.mock('nia-ai-ts')` or bun's equivalent `mock.module`) that records calls — the repo's existing Phase 3/4 test doubles for the SDK adapter are the template. Do NOT import `NiaClient` or reference the deleted `src/api/client.ts`.

At minimum each feature PR must cover:
1. **Happy path invocation** — construct the tool factory with the mocked SDK adapter, call `execute()` with a fixed input, assert the mock recorded the expected SDK method call (e.g., `sdk.sandbox.search(...)`) and assert the returned string shape.
2. **Missing-arg validation** — invoke with a required arg omitted; expect a `validation_error: …` return string and zero SDK method calls recorded.
3. **Auth failure** — configure the mocked SDK to throw `new NiaSDKError(401, 'Unauthorized')`, invoke the tool, assert the returned string starts with `unauthorized [401]` (via `classifyApiError` in `src/utils/format.ts`, which Phase 4 updated to unwrap SDK errors).
4. **Tool registration check** — add a colocated unit test `src/tools/<new-tool>.test.ts` that imports `{ createNia<Feature>Tool }` from the new file and asserts the factory is imported and wired up in `src/index.ts`. Verify via `bun test src/tools/<new-tool>.test.ts` plus a static grep: `rg -n 'createNia<Feature>Tool' src/index.ts` must return at least one hit.
5. **README tool table row** — the README's available-tools table contains a row for the new tool (verified by grep: `rg -n '<new-tool>' README.md`).
6. **Live API integration test** (gated on `NIA_API_KEY`) — add `tests/integration/<new-tool>.test.ts` that exercises the tool against the real API through the post-Phase-4 adapter. Follow the same pattern as existing Phase 3/4 SDK-mode integration tests.

Example for a hypothetical `nia_sandbox` built on top of the post-Phase-4 SDK adapter:

| # | Test step                                                                                                 | Expected SDK call / check                                   | Expected return value                                      | Pass? |
| - | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- | ----- |
| 1 | `execute({repository:"https://github.com/vercel/ai", query:"streamText"})` with mocked SDK adapter          | `sdk.sandbox.search({repository, ref:"main", query})` called once | Returned string contains `job_id`; SSE stream events observed | [ ]   |
| 2 | `execute({query:"x"})` (missing `repository`)                                                                | Zero SDK calls recorded                                     | Returned string matches `/^validation_error.*repository/`  | [ ]   |
| 3 | `execute(...)` with mocked SDK throwing `new NiaSDKError(401, 'Unauthorized')`                              | `sdk.sandbox.search(...)` called once, throws                 | Returned string starts with `unauthorized [401]`            | [ ]   |
| 4 | `rg -n 'createNiaSandboxTool' src/index.ts`                                                                 | —                                                           | Exit 0; factory imported and registered in `src/index.ts`  | [ ]   |
| 5 | `rg -n 'nia_sandbox' README.md`                                                                             | —                                                           | Exit 0; row in available-tools table                       | [ ]   |
| 6 | `bun run test:integration -- sandbox` against live API (with `NIA_API_KEY` set)                             | Real HTTP request captured in harness log                   | Test passes against live endpoint                          | [ ]   |
<!-- table not formatted: invalid structure -->

**Acceptance criteria (per feature):**
1. Tool registered in `src/index.ts`.
2. All six rows of the smoke test template above pass and are documented in the PR description.
3. Colocated unit test at `src/tools/<new-tool>.test.ts` exists and covers the happy path, validation failures, and auth failure.
4. Integration test at `tests/integration/<new-tool>.test.ts` exists and is gated on `NIA_API_KEY`.
5. README updated with a row in the available-tools table.
6. `package.json` version bumped (minor).

**Phase 5 completion criteria (all of these must be true before the migration as a whole is considered complete):**
1. All six required features above have shipped as separate PRs, each meeting the per-feature acceptance criteria.
2. README has six new rows in the available-tools table (or five, if bulk-delete is implemented as a new action on `nia_manage_resource` rather than a new tool).
3. `src/config.ts` exposes all six feature flags with sensible defaults.
4. Plugin version reflects the last feature bump (e.g., `v0.6.0` or later depending on how many minor bumps accumulated during Phase 5).

**Estimated effort:** 1–2 days per feature.
**Risk level:** low (purely additive).

---

## 7. Testing Strategy

### 7.1 Unit tests
- **Layout:** tests are colocated next to their implementation as `src/**/*.test.ts`. This matches the existing 33 test files in the repo and is what `package.json` scripts `test:unit` (`bun test src/`) and `lint` (`biome check … src/`) actually cover. New tests placed outside `src/` will not run under these gates.
- Every bug fix in Phase 1 gets an assertion added to the existing colocated test file for that tool/module.
- Every endpoint migration in Phase 2 gets a test that asserts the new path.
- Every SDK adoption step in Phase 3 runs both paths (legacy + SDK) and asserts identical behavior.
- Test doubles use `fetch` stubs for `NiaClient` paths and module mocks for `nia-ai-ts` on the SDK path. The repo currently uses `bun test` as the runner (with `vitest` available in devDependencies); Phase 1 should use whichever mock style the existing test files already use.

### 7.2 Integration tests
- Gated behind `NIA_API_KEY` env var (skip if unset).
- Cover the happy path for each tool against live Nia API.
- Verify response shapes match our types.
- Run in CI on a schedule (not on every PR) to avoid flakiness from external service.

### 7.3 Smoke test matrices
Each phase has its own smoke test matrix defined inside the phase section, not here. They live at:
- **Phase 1:** §6 Phase 1 smoke test matrix (13 rows covering Bugs #1–#9 plus the static enum grep).
- **Phase 2:** §6 Phase 2 smoke test matrix (15 rows covering unified `/sources` and `/search` paths plus a grep gate).
- **Phase 3:** §6 Phase 3 per-tool smoke test matrix (runs every migrated tool under both `NIA_USE_SDK=false` and `NIA_USE_SDK=true` and diffs the results).
- **Phase 4:** §6 Phase 4 deletion verification matrix (11 rows covering `NiaClient` removal, bundle size check, full tool rerun).
- **Phase 5:** §6 Phase 5 per-feature smoke test template (5 rows per new tool).

All matrices use the `tests/integration/real-api.test.ts` harness pattern: instantiate the tool factory directly with the phase-appropriate HTTP surface (Phases 1–2: `NiaClient` with a request-logging `fetchFn`; Phase 3: dual-mode `NiaClient`+`NiaSDK`; Phases 4–5: mocked `NiaSDK` adapter), invoke `execute()` with fixed input, assert on recorded calls / returned string.

### 7.4 Regression safety net
Before Phase 2 starts, capture the current plugin behavior by running all integration tests against live API and saving the responses. These become the baseline for verifying Phases 2/3 don't regress.

---

## 8. Rollout Plan

### 8.1 Release strategy
- Phase 1 → `v0.3.2` (patch — bug fixes only)
- Phase 2 → `v0.4.0` (minor — internal migration, no user-visible break)
- Phase 3 → `v0.5.0-beta.N` releases during migration (npm `beta` tag)
- Phase 3 complete → `v0.5.0`
- Phase 4 → `v0.5.1` or `v0.6.0`
- Phase 5 → each of the six required features gets its own minor bump (Phase 5 is mandatory per user directive 2026-04-12; the migration is not complete until all six have shipped)

### 8.2 Communication
- **No CHANGELOG.md exists in this repo today.** Release notes live entirely in PR descriptions and GitHub release notes for each tagged version. If the user wants a dedicated `CHANGELOG.md` introduced, that's a separate PR out of scope for this plan.
- Each phase's PR description captures the visible behavior changes using a "Before / After" section.
- GitHub releases (created at each version bump) reuse the PR description as the release body.
- Phase 1 PR description lists all 9 bugs with a before/after one-liner and the smoke matrix results from §7.3.
- Phase 2 PR description includes the Phase 2 smoke test matrix results.
- Phase 3 PR(s) reference this plan file and explain the feature flag; each sub-step PR includes the per-tool smoke matrix for the tool being migrated.
- Phase 4 PR description includes the 11-row Phase 4 smoke matrix results and the bundle size delta.
- Phase 5 per-feature PRs include the feature-specific smoke table.
- README updated as each phase lands (explicit scope: Phase 3 adds `NIA_USE_SDK` docs; Phase 4 removes them; Phase 5 adds new tool rows).

### 8.3 Rollback plan
- Phase 1: revert the PR. Bugs return.
- Phase 2: revert the PR. Legacy endpoints still work (for now).
- Phase 3: disable `NIA_USE_SDK` flag in config. SDK code stays in place but isn't used.
- Phase 4: no rollback beyond reverting the deletion PR; Phase 3 must be confirmed solid before Phase 4 ships.

---

## 9. Risk Matrix

| Risk                                                                                             | Probability | Impact | Mitigation                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Phase 1 fix breaks a working tool                                                                | low         | medium | Unit test every fix; run full suite before merge; integration smoke tests                                              |
| Phase 2 migration misses a code path using legacy endpoint                                       | medium      | medium | Grep-based verification gate; legacy endpoints still work during transition                                           |
| SDK doesn't support an endpoint we need (e.g., filesystem, advisor, e2e)                         | medium      | high   | Phase 3 explicitly uses low-level SDK services for these; fallback to manual low-level calls if a service is missing |
| SDK types don't match our internal type expectations                                             | medium      | low    | Keep plugin-internal types as adapters; shim where needed                                                              |
| SSE streaming shape differs between SDK and our expectations                                     | medium      | medium | Phase 1 bug fix establishes a working baseline (via `/stream` endpoints); Phase 3 reuses that pattern or SDK method    |
| Nia API changes again mid-migration                                                              | low         | high   | Plan is phased so each phase independently makes sense; we can pause between phases                                     |
| `nia_e2e` endpoints turn out to be broken too (not verified in Phase 0)                          | medium      | low    | Add to Phase 1 verification scope at start; treat as Bug #10 if confirmed                                             |
| Breaking change in tool schemas is unavoidable for a bug fix                                     | low         | high   | None required so far — all Phase 1 fixes preserve tool args; revisit if a fix demands a schema change                 |
| Integration tests flaky due to rate limits                                                       | medium      | low    | Gate integration tests behind explicit opt-in; use a dedicated test API key; add retry-with-backoff in test harness    |
| Phase 3 "feature flag" approach leaves dead code paths live                                      | medium      | low    | Phase 4 explicitly removes the flag; set a soft deadline (e.g., one release cycle) before Phase 4 starts              |
<!-- table not formatted: invalid structure -->

---

## 10. Open Questions (for clarification before Phase 1 starts)

1. **E2E endpoints unverified.** Should we expand Phase 1 verification to confirm `/daemon/e2e/*` paths against a live API call before assuming they're correct?
2. **Tracer deep mode trigger.** Bug #4 says to change the URL, but we don't know for certain whether the unified `POST /github/tracer` endpoint distinguishes fast vs deep mode via the request body's `mode` field or a different mechanism. Needs a live-API probe during Phase 1.
3. **Subscribe endpoint under unified `/sources`.** ~~Does it exist?~~ **RESOLVED 2026-04-12** via fetch of `https://docs.trynia.ai/llms-full.txt`: **no replacement exists**. Subscription was a legacy per-type concept (`POST /{repositories|data-sources|research-papers}/{id}/subscribe`). The unified `/sources` resource has no `/subscribe` sub-resource. Phase 2 handles this by returning a deprecation notice from `nia_manage_resource action=subscribe` without making an HTTP request. See the "Note on `subscribe` action" in Phase 2 for the full behavior.
4. **`data_source` migration path.** If any existing user has agents that pass `source_type=data_source`, we need to either (a) silently translate to `documentation` or (b) return a helpful error. Which does the user prefer?
5. **Integration test API key.** Does CI have access to a `NIA_API_KEY` secret for gated integration tests, or are those tests local-only?
6. **Release cadence.** Should Phase 1 ship immediately as a hotfix, or batch with Phase 2 into a single `v0.4.0` release?
7. **SDK version pinning.** Pin `nia-ai-ts` to an exact version or use `^` for auto-updates? The SDK is auto-generated so it may ship breaking changes with a patch version; recommend exact pinning.
8. **`NIA_USE_SDK` default.** Start with `false` (legacy default, explicit opt-in to SDK) or `true` (SDK default, opt-out for legacy) in Phase 3? Recommendation: start at `false`, flip to `true` mid-Phase 3 once we're confident, delete in Phase 4.

---

## 11. References

### Primary sources (verified 2026-04-12)
- Nia OpenAPI v2 spec: `https://docs.trynia.ai/openapi-v2.yaml`
- Nia docs index: `https://docs.trynia.ai/llms.txt`
- Unified search reference: `https://docs.trynia.ai/api-reference/search/unified-search`
- Unified sources reference: `https://docs.trynia.ai/api-reference/sources/create-source`, `https://docs.trynia.ai/api-reference/sources/list-sources`
- Filesystem endpoint references: `https://docs.trynia.ai/api-reference/filesystem/{read-file,get-file-tree,grep-search,write-file}`
- Package search reference: `https://docs.trynia.ai/api-reference/search/semantic-package-search`
- Context update reference: `https://docs.trynia.ai/api-reference/contexts/update-context`
- SDK quickstart: `https://docs.trynia.ai/sdk/`
- SDK authentication: `https://docs.trynia.ai/sdk/authentication`
- SDK examples: `https://docs.trynia.ai/sdk/examples`
- API guide: `https://docs.trynia.ai/api-guide`

### Plugin source references (verified 2026-04-12)
- HTTP client: `src/api/client.ts`
- Type definitions: `src/api/types.ts`
- Tool implementations: `src/tools/nia-*.ts` (17 files)
- Background job manager: `src/state/job-manager.ts`
- Operation status tracker: `src/state/ops-tracker.ts`
- Source resolver: `src/tools/source-resolver.ts`
- Config loader: `src/config.ts`
- Error formatter: `src/utils/format.ts`

### Related prior plans
- `.sisyphus/plans/nia-cleanup.md`
- `.sisyphus/plans/nia-improvements.md`
- `.sisyphus/plans/plugin-tool-resilience.md`
