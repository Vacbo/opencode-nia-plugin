# Nia Tools Reference

Nia provides 21 native tools for indexing and searching external repositories, documentation, research papers, local folders, and performing AI-powered research. Use these tools to reduce hallucinations and provide up-to-date context for AI agents.

## CRITICAL: Nia-First Workflow

**Before using WebFetch or WebSearch:**

1. **Check indexed sources first**: `nia_manage_resource(action='list', query='keyword')` — many sources may already be indexed
2. **If source exists**: Use `nia_search`, `nia_grep`, `nia_read`, `nia_explore` for targeted queries
3. **If source doesn't exist but you know the URL**: Index it with `nia_index`, then search
4. **Only if source unknown**: Use `nia_research(mode='quick')` to discover URLs, then index

**Why**: Indexed sources provide more accurate, complete context than web fetches. WebFetch returns truncated content while Nia provides full source code and documentation.

## Deterministic Research Workflow

1. Check if the source is already indexed using `nia_manage_resource` (use targeted `query` to save tokens)
2. If indexed, explore the tree or list relevant directories
3. After understanding structure, use `nia_search`, `nia_grep`, `nia_read` for targeted searches
4. Use `nia_context` to save findings for reuse across sessions
5. Track indexed sources in a local `.md` file to avoid repeated listing

## Tool Reference (21 Tools)

### Core Search & Retrieval

#### nia_search
Semantic search across indexed repos, docs, papers, and local folders.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `repositories` | string[] | No | Repository identifiers to search |
| `data_sources` | string[] | No | Data source IDs to search |
| `search_mode` | enum | No | `"universal"` (default), `"query"`, `"web"`, `"deep"` |
| `max_tokens` | number | No | Max tokens to return (default: 5000) |
| `include_sources` | boolean | No | Include source metadata |
| `num_results` | number | No | Number of results (default: 10, max: 20) |
| `e2e_session_id` | string | No | E2E session ID for scoped search |
| `local_folders` | string[] | No | Local folder paths to include |

**Use for**: Primary search tool. Semantic mode for conceptual queries.

---

#### nia_read
Read specific files from indexed sources.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_type` + `identifier` | strings | Alternative | Type ("repository", "docs", "arxiv", "local_folder") + identifier |
| `source_id` | string | Alternative | Direct source ID from manage_resource |
| `path` | string | Yes | File path within the source |
| `line_start` | number | No | Starting line (1-indexed) |
| `line_end` | number | No | Ending line (1-indexed) |

**Use for**: Reading file contents after finding via search/grep/explore.

---

#### nia_grep
Regex search across indexed codebases.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_type` + `identifier` | strings | Alternative | Type + identifier |
| `source_id` | string | Alternative | Direct source ID |
| `pattern` | string | Yes | Regex pattern |
| `context_lines` | number | No | Context lines around matches (default: 2) |
| `case_sensitive` | boolean | No | Case-sensitive matching |

**Use for**: Finding exact patterns, function names, variable usage.

---

#### nia_explore
Browse file trees of indexed repos and docs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_type` + `identifier` | strings | Alternative | Type + identifier |
| `source_id` | string | Alternative | Direct source ID |
| `path` | string | No | Subdirectory to explore (default: root) |
| `max_depth` | number | No | Max depth to traverse (default: 3) |

**Use for**: Understanding project structure, discovering files before searching.

---

### Source Management

#### nia_index
Index new GitHub repos, documentation sites, arXiv papers, or local folders.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL to index (GitHub, docs, arXiv, or local path) |
| `source_type` | enum | No | `"repository"`, `"docs"`, `"arxiv"`, `"local_folder"` — auto-detected if omitted |
| `name` | string | No | Custom name for the source |

**Returns**: `source_id` immediately with `queued` status. Progress tracked via OpsTracker (not JobManager). Check completion with `nia_manage_resource(action='status', source_id=...)`. Indexing takes 1-5 minutes.

---

#### nia_manage_resource
List, check status, and manage indexed sources.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | `"list"`, `"status"`, `"rename"`, `"delete"`, `"subscribe"`, `"category_list"`, `"category_create"`, `"category_delete"` |
| `query` | string | No | Filter sources by keyword (use with list) |
| `source_id` | string | No | Source ID for status/rename/delete actions |
| `new_name` | string | No | New name for rename action |
| `category` | string | No | Category for organize actions |
| `description` | string | No | Description for category_create |
| `name` | string | No | Name for category_create |

**Use for**: First step in any Nia workflow. Always use `query` to filter large source lists.

---

### Research & Analysis

#### nia_research
Web search and AI-powered deep research.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes* | Research query (*required unless using job_id) |
| `mode` | enum | No | `"quick"` (default), `"deep"`, `"oracle"` |
| `job_id` | string | No | Check status of oracle research |
| `num_results` | number | No | Sources to analyze (default: 5, max: 20) |

**Modes**:
- `quick`: Fast web search for discovering URLs
- `deep`: Comprehensive research with synthesis
- `oracle`: Expert-level analysis (async, see below)

**Async (oracle mode)**: Returns immediately with Job ID. Results delivered via system reminder when SSE stream completes. Continue with other work while processing.

---

#### nia_advisor
Get AI-powered advice based on indexed codebases.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Question or advice request |
| `codebase` | object | No | `{ summary, dependencies, file_tree, files, focus_paths, git_diff }` |
| `search_scope` | object | No | `{ repositories, data_sources }` |
| `output_format` | enum | No | `"explanation"`, `"checklist"`, `"diff"`, `"structured"` |

**Use for**: Implementation advice, pattern recommendations, best practices from real code.

---

#### nia_tracer
Deep code analysis and tracing across repositories.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes* | Tracing query (*required unless using job_id) |
| `repositories` | string[] | No | Repositories to trace within |
| `tracer_mode` | enum | No | `"tracer-fast"` (default), `"tracer-deep"` |
| `job_id` | string | No | Check status of deep traces |

**Modes**:
- `tracer-fast`: Quick analysis, returns inline
- `tracer-deep`: Comprehensive cross-repo tracing (async, see below)

**Async (tracer-deep)**: Returns immediately with Job ID. Results delivered via system reminder when SSE stream completes.

---

#### nia_sandbox
Search a public repo through an ephemeral sandbox clone.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repository` | string | Yes* | Repository (owner/repo format) |
| `ref` | string | No | Branch/tag (default: "main") |
| `query` | string | Yes* | Search query |
| `job_id` | string | No | Check status of async job |

**Async behavior**: Small repos may return inline results. Large repos submit a job and return immediately with Job ID. Results delivered via system reminder.

---

#### nia_document_agent
Analyze indexed PDF documents with AI agent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | `"sync"`, `"async_submit"`, `"async_status"`, `"async_stream"`, `"async_delete"` |
| `source_id` | string | No | Single source ID (for sync/async_submit) |
| `source_ids` | string[] | No | Multiple source IDs (max 10, for sync/async_submit) |
| `query` | string | No | Query (required for sync/async_submit) |
| `job_id` | string | No | Job ID (required for async_status/async_stream/async_delete) |
| `json_schema` | string | No | JSON schema for structured output |
| `model` | string | No | Model override |
| `thinking_enabled` | boolean | No | Enable thinking mode |
| `thinking_budget` | number | No | Thinking budget (1000-50000) |

**Actions**:
- `sync`: Synchronous query, returns immediately
- `async_submit`: Submit async job (returns Job ID, results delivered via SSE)
- `async_status`: Check job status
- `async_stream`: Start/resume SSE stream for existing job
- `async_delete`: Cancel job

---

### Context & Utilities

#### nia_context
Save, load, and manage cross-agent research context.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | `"save"`, `"list"`, `"retrieve"`, `"search"`, `"update"`, `"delete"` |
| `id` | string | No | Context identifier |
| `content` | string | No | Content to save |
| `title` | string | No | Context title |
| `summary` | string | No | Brief summary |
| `tags` | string | No | Comma-separated tags |
| `query` | string | No | Search query (for search action) |
| `limit` | string | No | Result limit |

**Use for**: Saving research findings for reuse across sessions. Tag contexts by topic.

---

#### nia_package_search
Search package registries (npm, PyPI, crates.io, Go).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `registry` | enum | Yes | `"npm"`, `"pypi"`, `"crates"`, `"go"` |
| `package_name` | string | No | Exact package name |
| `semantic_queries` | string | No | Natural language queries (comma-separated) |
| `pattern` | string | No | Regex pattern for package name matching |

**Use for**: Finding packages by functionality or exact name.

---

#### nia_auto_subscribe
Subscribe to docs from project manifests.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `manifest_content` | string | Yes | Content of package.json, requirements.txt, etc. |
| `manifest_type` | string | Yes | Manifest type identifier |
| `dry_run` | string | No | `"true"` to preview without applying |

**Use for**: New project setup. Auto-identifies relevant documentation from dependencies.

---

#### nia_e2e
End-to-end encrypted local folder sessions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | `"create_session"`, `"get_session"`, `"purge"`, `"sync"` |
| `local_folder_id` | string | No | Associate local folder |
| `source_id` | string | No | Source to include |
| `session_id` | string | No | Existing session ID |
| `ttl_seconds` | number | No | Session TTL (default: 3600) |
| `max_chunks` | number | No | Max chunks to process |
| `allowed_operations` | string[] | No | Restrict operations |

**Use for**: Complex research on encrypted local folders.

---

#### nia_usage
Retrieve Nia API quota and usage information.

**No parameters**

**Returns**: Plan, credits used, credits remaining, reset date.

---

#### nia_feedback
Submit feedback on answers, sources, or interactions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | `"answer"`, `"source"`, `"interaction"` |
| `answer_id` | string | No | Answer ID (for answer feedback) |
| `source_id` | string | No | Source ID (for source feedback) |
| `interaction_id` | string | No | Interaction ID (for interaction feedback) |
| `feedback_type` | string | No | Type (e.g., "thumbs_up", "helpful", "viewed") |
| `comment` | string | No | Optional comment |
| `metadata` | string | No | Optional JSON metadata |

**Use for**: Improving Nia results over time with thumbs up/down feedback.

---

### Filesystem Operations (Indexed Sources)

#### nia_write
Create or update a file in an indexed source.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_id` | string | Alternative | Direct source ID |
| `source_type` + `identifier` | strings | Alternative | Type + identifier |
| `path` | string | Yes | File path |
| `body` | string | Yes | File content |
| `encoding` | enum | No | `"utf8"` (default), `"base64"` |
| `language` | string | No | Programming language hint |
| `headers` | object | No | Metadata headers |

---

#### nia_rm
Delete a file from an indexed source.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_id` | string | Alternative | Direct source ID |
| `source_type` + `identifier` | strings | Alternative | Type + identifier |
| `path` | string | Yes | File path to delete |

---

#### nia_mv
Move or rename a file in an indexed source.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_id` | string | Alternative | Direct source ID |
| `source_type` + `identifier` | strings | Alternative | Type + identifier |
| `old_path` | string | Yes | Current file path |
| `new_path` | string | Yes | New file path |

---

#### nia_mkdir
Create a directory in an indexed source.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_id` | string | Alternative | Direct source ID |
| `source_type` + `identifier` | strings | Alternative | Type + identifier |
| `path` | string | Yes | Directory path to create |

---

## Async/Non-Blocking Operations

Four tools use the JobManager with SSE streaming for long-running operations:

| Tool | Trigger | JobType | Delivery |
|------|---------|---------|----------|
| `nia_research(mode='oracle')` | oracle mode | `oracle` | System reminder |
| `nia_tracer(tracer_mode='tracer-deep')` | deep mode | `tracer` | System reminder |
| `nia_sandbox` | large repos | `sandbox` | System reminder |
| `nia_document_agent(action='async_submit')` | async_submit | `document_agent` | System reminder |

### How It Works

1. Tool submits job to Nia API, starts SSE stream in background
2. Tool returns **immediately**: `"Oracle research started. Job ID: abc-123"`
3. Agent continues with other work
4. SSE stream completes in background
5. Results delivered via system reminder:

```
<system-reminder>[NIA ORACLE COMPLETE]
... full results ...
</system-reminder>
```

### Pending Job Awareness

While async operations run, the system prompt includes:

```
⏳ Waiting for Nia operations to complete:
- Oracle research (Job ID: oracle-1)
- Tracer analysis (Job ID: tracer-1)
```

This prevents premature session completion.

### Best Practices

1. **Fire early, use later** — start oracle/tracer-deep at the beginning, use results when they arrive
2. **Parallel is free** — multiple deep calls run simultaneously
3. **Don't poll** — results arrive automatically; manual `job_id` checks are rarely needed
4. **Continue working** — proceed with synchronous tasks while deep operations run

### nia_index (Different Pattern)

`nia_index` uses OpsTracker (not JobManager):

1. Call `nia_index(url="...")` → returns immediately with `source_id`
2. Status tracked via `experimental.chat.system.transform`
3. Completion notified via system prompt: `"Background completions: ..."`
4. Check status with `nia_manage_resource(action='status', source_id=...)`

---

## Decision Tree: Which Tool to Use?

```
START: Need information about X
│
├─→ Is X from an already indexed source?
│   ├─→ YES: Use nia_search, nia_grep, nia_read, or nia_explore
│   │       ├─→ Know exact file path? → nia_read
│   │       ├─→ Know pattern/symbol? → nia_grep
│   │       ├─→ Need structure overview? → nia_explore
│   │       └─→ General semantic query? → nia_search
│   │
│   └─→ NO: Do you know the URL?
│       ├─→ YES: nia_index → wait → then search tools
│       └─→ NO: Need to discover sources?
│           ├─→ Quick discovery → nia_research(mode='quick')
│           └─→ Deep research needed → nia_research(mode='deep' or 'oracle')
│
├─→ Need package/library recommendations?
│   └─→ nia_package_search
│
├─→ Need implementation advice from code examples?
│   └─→ nia_advisor
│
├─→ Complex cross-repo code analysis?
│   └─→ nia_tracer (tracer-deep for async)
│
├─→ Search public repo without indexing?
│   └─→ nia_sandbox
│
├─→ Analyze PDF documents?
│   └─→ nia_document_agent
│
├─→ Multi-step research session?
│   └─→ nia_e2e
│
├─→ Save findings for later?
│   └─→ nia_context
│
└─→ Check quota or submit feedback?
    ├─→ nia_usage
    └─→ nia_feedback
```

---

## Pre-WebFetch Checklist

Before ANY WebFetch or WebSearch call, verify:
- [ ] Ran `nia_manage_resource(action='list', query='...')` for relevant keywords
- [ ] Checked local `.md` files for previously indexed sources
- [ ] Confirmed no indexed source covers this information
- [ ] For GitHub/npm/PyPI URLs: These should ALWAYS be indexed, not fetched

---

## Agent-Specific Soft Routing

### Research Agents (oracle, librarian, explore)
- **Primary**: `nia_search`, `nia_research`, `nia_tracer`
- **Secondary**: `nia_context` (save), `nia_advisor` (recommendations)
- **Pattern**: `manage_resource(list)` → search/research → `context(save)`

### Build Agents (implementer, coder)
- **Primary**: `nia_search`, `nia_grep`, `nia_read`
- **Secondary**: `nia_advisor` (patterns), `nia_package_search` (dependencies)
- **Pattern**: `manage_resource` → `explore` → grep/read → implement

### Planning Agents (architect, planner)
- **Primary**: `nia_search`, `nia_advisor`, `nia_package_search`
- **Secondary**: `nia_research` (deep/oracle)
- **Pattern**: research → advisor → package_search → context(save plan)

### Review Agents (reviewer, auditor)
- **Primary**: `nia_search`, `nia_grep`, `nia_tracer`
- **Secondary**: `nia_advisor` (best practice comparison)
- **Pattern**: grep → tracer → advisor

---

## Anti-Patterns

### Never Do These

1. **WebFetch before checking Nia**
   - Wrong: `webfetch(url="https://docs.example.com")` without checking indexed sources
   - Right: `nia_manage_resource(action='list', query='example')` first

2. **Indexing without checking first**
   - Wrong: Immediately `nia_index` on every request
   - Right: Check `manage_resource(list)` — source may already exist

3. **Polling for async results**
   - Wrong: Calling `nia_research(mode='oracle')` then immediately polling with `job_id`
   - Right: Results auto-deliver. Continue with other work.

4. **Using wrong search mode**
   - Wrong: `nia_search(query='function handleError')` for exact symbols
   - Right: `nia_grep(pattern='handleError')` for code patterns

5. **Not saving research context**
   - Wrong: Re-researching the same sources every conversation
   - Right: `nia_context(action='save', id='project-research', ...)`

6. **Deep research for simple lookups**
   - Wrong: `nia_research(mode='oracle', query='latest React version')`
   - Right: `nia_package_search(registry='npm', package_name='react')`

7. **Not using query filter on manage_resource**
   - Wrong: `manage_resource(action='list')` with 100+ sources
   - Right: `manage_resource(action='list', query='react')` to filter

### Always Do These

1. Check indexed sources first — every time
2. Use targeted queries — filter source lists and searches
3. Save context — make research reusable
4. Fire deep operations early — start oracle/tracer-deep first
5. Index strategically — root URLs for docs, not individual pages
6. Match tool to task — grep for patterns, search for semantics, read for content

---

## Environment Configuration

The plugin reads **only** `process.env.*` at runtime. No `nia.json` file is read.

### Required

| Variable | Description |
|----------|-------------|
| `NIA_API_KEY` | Your Nia API key (from app.trynia.ai) |

### Connection

| Variable | Default | Description |
|----------|---------|-------------|
| `NIA_API_URL` | `https://apigcp.trynia.ai/v2` | Nia API endpoint |

### Feature Toggles

| Variable | Default | Description |
|----------|---------|-------------|
| `NIA_SEARCH` | `true` | Enable search/read/grep/explore/write/rm/mv/mkdir |
| `NIA_RESEARCH` | `true` | Enable nia_research |
| `NIA_TRACER` | `true` | Enable nia_tracer |
| `NIA_ADVISOR` | `true` | Enable nia_advisor |
| `NIA_CONTEXT` | `true` | Enable nia_context |
| `NIA_E2E` | `true` | Enable nia_e2e |
| `NIA_SANDBOX_ENABLED` | `true` | Enable nia_sandbox |
| `NIA_USAGE_ENABLED` | `true` | Enable nia_usage |
| `NIA_FEEDBACK_ENABLED` | `true` | Enable nia_feedback |
| `NIA_DOCUMENT_AGENT_ENABLED` | `true` | Enable nia_document_agent |
| `NIA_ANNOTATIONS_ENABLED` | `true` | Enable resource annotations |
| `NIA_BULK_DELETE_ENABLED` | `true` | Enable bulk delete operations |

### Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `NIA_CACHE_TTL` | `300` | Cache TTL in seconds |
| `NIA_MAX_PENDING_OPS` | `5` | Max pending background operations |
| `NIA_CHECK_INTERVAL` | `15` | Status check interval in seconds |
| `NIA_TRACER_TIMEOUT` | `120` | Tracer timeout in seconds |
| `NIA_DEBUG` | `false` | Enable debug logging |

---

## Quick Reference Table

| Task | Primary Tool | Secondary Tool |
|------|--------------|----------------|
| Find code examples | `nia_search` | `nia_grep` |
| Read implementation | `nia_read` | `nia_explore` |
| Discover packages | `nia_package_search` | `nia_search` |
| Get best practices | `nia_advisor` | `nia_search` |
| Trace code flow | `nia_tracer` | `nia_grep` |
| Research new topic | `nia_research` | `nia_index` |
| Search public repo (no index) | `nia_sandbox` | — |
| Analyze PDFs | `nia_document_agent` | — |
| Save findings | `nia_context` | — |
| Project setup | `nia_auto_subscribe` | `nia_index` |
| Complex analysis | `nia_e2e` | `nia_tracer` |
| Check quota | `nia_usage` | — |
| Submit feedback | `nia_feedback` | — |
| Write file to source | `nia_write` | — |
| Delete source file | `nia_rm` | — |
| Move source file | `nia_mv` | — |
| Create source directory | `nia_mkdir` | — |

---

## Installation

The plugin is a native OpenCode plugin registered via `@opencode-ai/plugin` SDK.

```bash
# Install the skill
npx skills add nozomio-labs/nia-skill -g -a opencode -y
```

Add to `opencode.json`:

```json
{
  "plugin": ["@vacbo/opencode-nia-plugin@latest"]
}
```

Store your API key:

```bash
mkdir -p ~/.config/nia
echo "nk_your_api_key" > ~/.config/nia/api_key
```
