# Nia Tools Reference Guide

Nia provides native tools for indexing and searching external repositories, research papers, local folders, documentation, packages, and performing AI-powered research. Its primary goal is to reduce hallucinations in LLMs and provide up-to-date context for AI agents.

## CRITICAL: Nia-First Workflow

**BEFORE using WebFetch or WebSearch, you MUST:**

1. **Check indexed sources first**: `manage_resource(action='list', query='relevant-keyword')` - Many sources may already be indexed
2. **If source exists**: Use `search`, `nia_grep`, `nia_read`, `nia_explore` for targeted queries
3. **If source doesn't exist but you know the URL**: Index it with `index` tool, then search
4. **Only if source unknown**: Use `nia_research(mode='quick')` to discover URLs, then index

**Why this matters**: Indexed sources provide more accurate, complete context than web fetches. WebFetch returns truncated/summarized content while Nia provides full source code and documentation.

## Deterministic Research Workflow

1. Check if the source is already indexed using `manage_resource` (when listing sources, use targeted query to save tokens since users can have multiple sources indexed) or check any nia.md files for already indexed sources.
2. If it is indexed, check the tree of the source or ls relevant directories.
3. After getting the grasp of the structure (tree), use `search`, `nia_grep`, `nia_read` for targeted searches.
4. If helpful, use the `context` tool to save your research findings to make them reusable for future conversations.
5. Save your findings in an .md file to track: source indexed, used, its ID, and link so you won't have to list sources in the future and can get straight to work.

## Tool Reference (13 Tools)

### 1. nia_search
Semantic search across indexed repos, docs, papers, and local folders.

**Parameters:**
- `query` (string, required): Search query
- `repositories` (string[], optional): Repository identifiers to search within
- `data_sources` (string[], optional): Data source IDs to search within
- `search_mode` (enum, optional): "semantic" (default), "keyword", or "hybrid"
- `max_tokens` (number, optional): Maximum tokens to return (default: 5000)
- `include_sources` (boolean, optional): Include source metadata in results
- `num_results` (number, optional): Number of results to return (default: 10)
- `e2e_session_id` (string, optional): E2E session ID for scoped search
- `local_folders` (string[], optional): Local folder paths to include in search

**When to use:** Primary search tool for finding relevant content across all indexed sources. Use semantic mode for conceptual queries, keyword for exact matches.

---

### 2. nia_read
Read specific files from indexed sources.

**Parameters:**
- `source_type` + `identifier` (alternative): Type ("github", "docs", "arxiv", "local") + identifier
- OR `source_id` (string, alternative): Direct source ID from manage_resource
- `path` (string, required): File path within the source
- `line_start` (number, optional): Starting line number (1-indexed)
- `line_end` (number, optional): Ending line number (1-indexed)

**When to use:** After finding a file via search/grep/explore, read its contents. Use line ranges for large files.

---

### 3. nia_grep
Regex search across indexed codebases.

**Parameters:**
- `source_type` + `identifier` (alternative): Type + identifier
- OR `source_id` (string, alternative): Direct source ID
- `pattern` (string, required): Regex pattern to search
- `context_lines` (number, optional): Lines of context around matches (default: 2)
- `case_sensitive` (boolean, optional): Case-sensitive matching (default: false)

**When to use:** Find exact patterns, function names, variable usage. More precise than semantic search for code patterns.

---

### 4. nia_explore
Browse file trees of indexed repos and docs.

**Parameters:**
- `source_type` + `identifier` (alternative): Type + identifier
- OR `source_id` (string, alternative): Direct source ID
- `path` (string, optional): Subdirectory path to explore (default: root)
- `max_depth` (number, optional): Maximum depth to traverse (default: 3)

**When to use:** Understand project structure, find relevant directories, discover available files before searching.

---

### 5. nia_index
Index new GitHub repos, documentation sites, arXiv papers, or local folders.

**Parameters:**
- `url` (string, required): URL to index (GitHub repo, docs site, arXiv paper, or local folder path)
- `source_type` (enum, optional): "github", "docs", "arxiv", "local" - auto-detected if not specified
- `name` (string, optional): Custom name for the indexed source

**When to use:** Source isn't indexed but you know the URL. For docs, always index the root URL (e.g., docs.stripe.com) to capture all pages.

**Important:** Indexing takes 1-5 minutes. The tool returns immediately but processing continues asynchronously. Check status with `manage_resource`.

---

### 6. nia_manage_resource
List, check status, and manage indexed sources.

**Parameters:**
- `action` (enum, required): 
  - `list`: List all indexed sources
  - `status`: Check status of specific source
  - `rename`: Rename a source
  - `delete`: Remove a source
  - `subscribe`: Subscribe to updates
  - `category_list`: List categories
  - `category_create`: Create category
  - `category_delete`: Delete category
- `query` (string, optional): Filter sources by keyword (use with list)
- `source_id` (string, optional): Source ID for status/rename/delete actions
- `new_name` (string, optional): New name for rename action
- `category` (string, optional): Category for organize actions

**When to use:** First step in any Nia workflow. Check what's indexed before searching. Use `query` parameter to filter large source lists.

---

### 7. nia_research
Web search and AI-powered deep research.

**Parameters:**
- `query` (string, required): Research query
- `mode` (enum, optional): 
  - `quick`: Fast web search (default)
  - `deep`: Comprehensive research with synthesis
  - `oracle`: Expert-level analysis with citations
- `job_id` (string, optional): For checking status of long-running research
- `num_results` (number, optional): Number of sources to analyze (default: 5)

**When to use:** 
- `quick`: Discover URLs for indexing, fast fact-checking
- `deep`: Comprehensive topic research when indexed sources insufficient
- `oracle`: Complex analysis requiring expert synthesis

**Long-running:** Deep and oracle modes return a `job_id`. Use it to check status: `nia_research(job_id='...')`.

---

### 8. nia_advisor
Get AI-powered advice based on indexed codebases.

**Parameters:**
- `query` (string, required): Question or advice request
- `codebase` (string, optional): Specific codebase to analyze
- `search_scope` (enum, optional): "narrow" (specific files), "broad" (full codebase), "auto" (default)
- `output_format` (enum, optional): "concise", "detailed", "structured" (default: detailed)

**When to use:** Need implementation advice, pattern recommendations, or best practices based on real code examples from indexed sources.

---

### 9. nia_context
Save, load, and manage cross-agent research context.

**Parameters:**
- `action` (enum, required):
  - `save`: Save current context
  - `list`: List saved contexts
  - `retrieve`: Load saved context
  - `search`: Search within saved contexts
  - `update`: Update existing context
  - `delete`: Remove saved context
- `context_id` (string, optional): Unique identifier for the context
- `content` (string, optional): Content to save (for save/update)
- `tags` (string[], optional): Tags for organization
- `query` (string, optional): Search query (for search action)

**When to use:** Save research findings for reuse across sessions. Tag contexts by topic for easy retrieval. Essential for multi-agent workflows.

---

### 10. nia_package_search
Search package registries (npm, PyPI, crates.io, etc.).

**Parameters:**
- `registry` (enum, required): "npm", "pypi", "crates", "maven", "go", "nuget"
- `package_name` (string, optional): Exact package name to look up
- `semantic_queries` (string[], optional): Natural language queries for discovery
- `pattern` (string, optional): Regex pattern for package name matching

**When to use:** Find packages by functionality (semantic_queries) or exact name. Great for discovering libraries that solve specific problems.

---

### 11. nia_auto_subscribe
Automatically subscribe to relevant sources based on project manifest.

**Parameters:**
- `manifest_content` (string, required): Content of package.json, requirements.txt, Cargo.toml, etc.
- `manifest_type` (enum, required): "package.json", "requirements.txt", "Cargo.toml", "go.mod", "pom.xml", etc.
- `dry_run` (boolean, optional): Preview subscriptions without applying (default: false)

**When to use:** New project setup. Automatically identifies and subscribes to relevant documentation and source repositories based on dependencies.

---

### 12. nia_tracer
Deep code analysis and tracing across repositories.

**Parameters:**
- `query` (string, required): Tracing query (e.g., "find all usages of function X", "trace data flow from Y to Z")
- `repositories` (string[], optional): Repositories to trace within
- `tracer_mode` (enum, optional):
  - `tracer-fast`: Quick analysis (default)
  - `tracer-deep`: Comprehensive cross-repo tracing
- `job_id` (string, optional): For checking status of long-running traces

**When to use:** Complex code analysis requiring understanding relationships across files/repos. Find all call sites, trace data flow, analyze dependencies.

**Long-running:** Tracer-deep returns a `job_id`. Check status with `nia_tracer(job_id='...')`.

---

### 13. nia_e2e
End-to-end session management for complex multi-step research.

**Parameters:**
- `action` (enum, required):
  - `create_session`: Start new E2E session
  - `get_session`: Retrieve session status/results
  - `purge`: Clear session data
  - `sync`: Synchronize session across agents
- `local_folder_id` (string, optional): Associate local folder with session
- `source_id` (string, optional): Source to include in session
- `session_id` (string, optional): Existing session ID (for get_session, purge, sync)
- `ttl_seconds` (number, optional): Session TTL (default: 3600)
- `max_chunks` (number, optional): Max chunks to process
- `allowed_operations` (string[], optional): Restrict operations in session

**When to use:** Complex research tasks spanning multiple tools and steps. Maintains state across operations. Essential for orchestrated multi-agent research.

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
│   └─→ nia_tracer
│
├─→ Multi-step research session?
│   └─→ nia_e2e (create_session) → other tools → nia_e2e (get_session)
│
└─→ Save findings for later?
    └─→ nia_context (save)
```

## Pre-WebFetch Checklist

Before ANY WebFetch or WebSearch call, verify:
- [ ] Ran `manage_resource(action='list', query='...')` for relevant keywords
- [ ] Checked nia-sources.md or nia.md files for previously indexed sources
- [ ] Confirmed no indexed source covers this information
- [ ] For GitHub/npm/PyPI URLs: These should ALWAYS be indexed, not fetched

## Agent-Specific Soft Routing Guidance

### Research Agents (oracle, librarian, explore)
- **Primary tools**: nia_search, nia_research, nia_tracer
- **Secondary**: nia_context (save findings), nia_advisor (for recommendations)
- **Pattern**: Start with manage_resource(list) → search/research → context(save)

### Build Agents (implementer, coder)
- **Primary tools**: nia_search, nia_grep, nia_read
- **Secondary**: nia_advisor (implementation patterns), nia_package_search (dependencies)
- **Pattern**: manage_resource → explore (structure) → grep/read (specifics) → implement

### Planning Agents (architect, planner)
- **Primary tools**: nia_search, nia_advisor, nia_package_search
- **Secondary**: nia_research (deep/oracle for comprehensive analysis)
- **Pattern**: research → advisor → package_search → context(save plan)

### Review Agents (reviewer, auditor)
- **Primary tools**: nia_search, nia_grep, nia_tracer
- **Secondary**: nia_advisor (best practice comparison)
- **Pattern**: grep (find patterns) → tracer (analyze flow) → advisor (validate)

## Long-Running Operations

Some tools return a `job_id` for asynchronous processing:

### nia_research (mode: deep, oracle)
```
1. First call: nia_research(query="...", mode="deep") → returns { job_id: "abc123" }
2. Poll: nia_research(job_id="abc123") → returns status or results when complete
3. Typical duration: 30 seconds to 5 minutes
```

### nia_tracer (mode: tracer-deep)
```
1. First call: nia_tracer(query="...", tracer_mode="tracer-deep") → returns { job_id: "xyz789" }
2. Poll: nia_tracer(job_id="xyz789") → returns status or results
3. Typical duration: 1 to 10 minutes depending on codebase size
```

### nia_index
```
1. Call: nia_index(url="...") → returns immediately, processing continues
2. Poll: manage_resource(action="status", source_id="...") to check indexing progress
3. Typical duration: 1 to 5 minutes depending on source size
```

**Best practice**: For long-running operations, save intermediate state to nia_context and inform the user of expected wait time.

## Anti-Patterns and Common Mistakes

### ❌ NEVER Do These

1. **WebFetch before checking Nia**
   - Wrong: `webfetch(url="https://docs.example.com/api")` without checking if docs are indexed
   - Right: `manage_resource(action="list", query="example docs")` first

2. **Indexing without checking first**
   - Wrong: Immediately `nia_index` on every request
   - Right: Check `manage_resource(list)` - source may already be indexed

3. **Ignoring job_id for long operations**
   - Wrong: Calling `nia_research(mode="oracle")` once and expecting immediate results
   - Right: Capture job_id, poll for completion, or use nia_e2e for session management

4. **Using wrong search mode**
   - Wrong: `nia_search(query="function handleError", search_mode="semantic")` for exact symbol
   - Right: `nia_grep(pattern="handleError")` for exact code patterns

5. **Not saving research context**
   - Wrong: Re-researching the same sources in every conversation
   - Right: `nia_context(action="save", context_id="project-research", ...)` for reuse

6. **Deep research for simple lookups**
   - Wrong: `nia_research(mode="oracle", query="what is the latest version of React")`
   - Right: `nia_package_search(registry="npm", package_name="react")` or `nia_search`

7. **Not using query filter on manage_resource**
   - Wrong: `manage_resource(action="list")` with 100+ sources, wasting tokens
   - Right: `manage_resource(action="list", query="react")` to filter relevant sources

### ✅ Always Do These

1. **Check indexed sources first** - Every. Single. Time.
2. **Use targeted queries** - Filter source lists and searches
3. **Save context** - Make research reusable across sessions
4. **Poll long operations** - Use job_id correctly
5. **Index strategically** - Root URLs for docs, not individual pages
6. **Match tool to task** - grep for patterns, search for semantics, read for content

## Condensed Routing Hints (For System Prompts)

```
NIA ROUTING (memorize this):
┌─────────────────────────────────────────────────────────────┐
│  CHECK FIRST: manage_resource(list, query='...')            │
├─────────────────────────────────────────────────────────────┤
│  SEMANTIC SEARCH  → nia_search                              │
│  EXACT PATTERN    → nia_grep                                │
│  READ FILE        → nia_read                                │
│  BROWSE STRUCTURE → nia_explore                             │
│  INDEX SOURCE     → nia_index                               │
│  DEEP RESEARCH    → nia_research(mode='deep/oracle')        │
│  CODE ADVICE      → nia_advisor                             │
│  SAVE CONTEXT     → nia_context                             │
│  FIND PACKAGES    → nia_package_search                      │
│  AUTO-SUBSCRIBE   → nia_auto_subscribe                      │
│  CODE TRACING     → nia_tracer                              │
│  E2E SESSION      → nia_e2e                                   │
├─────────────────────────────────────────────────────────────┤
│  LONG-RUNNING: Capture job_id, poll for completion            │
│  WEBFETCH LAST: Only after Nia sources exhausted            │
└─────────────────────────────────────────────────────────────┘
```

## Quick Reference: Tool Selection by Task

| Task | Primary Tool | Secondary Tool |
|------|--------------|----------------|
| Find code examples | nia_search | nia_grep |
| Read implementation | nia_read | nia_explore |
| Discover packages | nia_package_search | nia_search |
| Get best practices | nia_advisor | nia_search |
| Trace code flow | nia_tracer | nia_grep |
| Research new topic | nia_research | nia_index |
| Save findings | nia_context | - |
| Project setup | nia_auto_subscribe | nia_index |
| Complex analysis | nia_e2e | nia_tracer |

## Environment Configuration

Nia tools use environment variables for configuration (do not reference nia.json):
- `NIA_API_KEY`: Authentication key
- `NIA_ENDPOINT`: API endpoint URL
- `NIA_DEFAULT_TOKENS`: Default max_tokens for searches

These are configured at the system level and do not require per-project configuration files.
