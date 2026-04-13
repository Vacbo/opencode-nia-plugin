# nia-opencode

Installer and plugin for integrating [Nia Knowledge Agent](https://trynia.ai) with [OpenCode](https://opencode.ai). Provides indexed-source search, documentation lookup, deep research, and codebase exploration as native OpenCode tools.

Requires OpenCode `>= v1.1.50`.

## How It Works

The installer sets up two things:

1. **Native plugin** — `@vacbo/opencode-nia-plugin` registers 21 Nia tools directly through the `@opencode-ai/plugin` SDK. It runs inside OpenCode itself — no extra servers or daemons.
2. **Agent skill** (alternative / complementary) — `nozomio-labs/nia-skill` is installed via `npx skills add`. The agent discovers it on demand through the built-in `skill` tool.

Both read the API key from `~/.config/nia/api_key`. The plugin itself is configured through environment variables — no JSON config file is read at runtime.

## Installation

```bash
bunx nia-opencode@latest install
```

The installer will:

1. Prompt for your Nia API key
2. Store it at `~/.config/nia/api_key`
3. Install the `nia-skill` globally for OpenCode
4. Verify that `@vacbo/opencode-nia-plugin@latest` is registered in your `opencode.json`

### Non-Interactive Installation

```bash
bunx nia-opencode@latest install --no-tui --api-key nk_your_api_key
```

### Uninstall

```bash
bunx nia-opencode@latest uninstall
```

Removes the skill, plugin entry, and instructions URL from your OpenCode config.

## Configure `opencode.json`

Add the plugin to the `plugin` array:

```json
{
  "plugin": ["@vacbo/opencode-nia-plugin@latest"]
}
```

Add the Nia workflow guide to the `instructions` array:

```json
{
  "instructions": [
    "https://raw.githubusercontent.com/nozomio-labs/nia-opencode/main/instructions/nia-tools.md"
  ]
}
```

Export your API key so the plugin can reach the Nia API:

```bash
export NIA_API_KEY="nk_your_api_key"
```

## Runtime Configuration (Environment Variables)

The plugin reads all configuration from environment variables. No JSON file is consulted at runtime.

| Variable | Default | Description |
| --- | --- | --- |
| `NIA_API_KEY` | — | **Required.** Your Nia API key (`nk_...`). |
| `NIA_API_URL` | `https://apigcp.trynia.ai/v2` | Override the Nia API endpoint. |
| `NIA_DEBUG` | `false` | Enable verbose plugin logging. |
| `NIA_CACHE_TTL` | `300` | Per-session cache TTL (seconds). |
| `NIA_MAX_PENDING_OPS` | `5` | Max concurrent tracked operations per session. |
| `NIA_CHECK_INTERVAL` | `15` | Ops tracker poll interval (seconds). |
| `NIA_TRACER_TIMEOUT` | `120` | Tracer job timeout (seconds). |

### Per-Tool Feature Flags

Every flag defaults to `true`. Set to `false` to hide a tool from the agent.

| Variable | Tool |
| --- | --- |
| `NIA_SEARCH` | `nia_search` |
| `NIA_RESEARCH` | `nia_research` |
| `NIA_TRACER` | `nia_tracer` |
| `NIA_ADVISOR` | `nia_advisor` |
| `NIA_CONTEXT` | `nia_context` |
| `NIA_E2E` | `nia_e2e` |
| `NIA_SANDBOX_ENABLED` (or `NIA_SANDBOX`) | `nia_sandbox` |
| `NIA_USAGE_ENABLED` | `nia_usage` |
| `NIA_FEEDBACK_ENABLED` | `nia_feedback` |
| `NIA_DOCUMENT_AGENT_ENABLED` | `nia_document_agent` |
| `NIA_ANNOTATIONS_ENABLED` | Annotations in `nia_manage_resource` |
| `NIA_BULK_DELETE_ENABLED` | Bulk delete in `nia_manage_resource` |

## Available Tools

21 tools registered through the plugin. The full reference with parameters, workflows, and async semantics lives in [`instructions/nia-tools.md`](instructions/nia-tools.md).

| Tool | Description |
| ---- | ----------- |
| `nia_search` | Semantic search across indexed repos, docs, and papers |
| `nia_read` | Read file content from indexed sources |
| `nia_grep` | Regex search across indexed codebases |
| `nia_explore` | Browse file trees of indexed sources |
| `nia_index` | Index GitHub repos, docs sites, or arXiv papers (async via OpsTracker) |
| `nia_manage_resource` | List, inspect, rename, subscribe, delete, bulk delete, and annotate resources |
| `nia_research` | Quick web search, deep research, or **oracle** (async, SSE-delivered) |
| `nia_advisor` | Context-aware code analysis against indexed docs |
| `nia_context` | Save, retrieve, search, and manage reusable cross-session context |
| `nia_package_search` | Search npm, PyPI, crates.io, and Go package source code |
| `nia_auto_subscribe` | Subscribe to documentation for dependencies in a project manifest |
| `nia_sandbox` | Search a public repo through an ephemeral sandbox clone (async) |
| `nia_tracer` | Fast or **deep** GitHub repo tracing (deep mode is async, SSE-delivered) |
| `nia_e2e` | Manage E2E-encrypted local-folder sessions |
| `nia_write` | Create or update a file in an indexed source |
| `nia_rm` | Delete a file from an indexed source |
| `nia_mv` | Move or rename a file in an indexed source |
| `nia_mkdir` | Create a directory in an indexed source |
| `nia_usage` | Retrieve current Nia API quota and usage information |
| `nia_feedback` | Submit thumbs up/down feedback on answers and sources |
| `nia_document_agent` | Analyze indexed PDFs with cited answers (full async lifecycle) |

### Async / Non-Blocking Tools

Four tools return a `job_id` immediately and deliver results later through a `<system-reminder>` injected into the conversation via `session.promptAsync`:

- `nia_research(mode='oracle')`
- `nia_tracer(tracer_mode='tracer-deep')`
- `nia_sandbox`
- `nia_document_agent(action='async_submit')`

Agents should fire these early and continue working. Pending jobs are surfaced in the system prompt so the agent knows not to stall. `nia_index` uses a separate `OpsTracker` polling mechanism and reports progress through `nia_manage_resource`.

See [`instructions/nia-tools.md`](instructions/nia-tools.md) for the full async architecture and anti-patterns.

## Agent Skill (Alternative)

If you prefer a pure-bash integration instead of the native plugin, install the [nia-skill](https://github.com/nozomio-labs/nia-skill) directly:

```bash
mkdir -p ~/.config/nia
echo "nk_your_api_key" > ~/.config/nia/api_key
npx skills add nozomio-labs/nia-skill -g -a opencode -y
```

The skill provides bash scripts that call the Nia REST API directly. `curl` and `jq` are required.

## CLI Reference

```
nia-opencode - Nia Knowledge Agent for OpenCode

Commands:
  install                Install and configure Nia for OpenCode
    --no-tui             Non-interactive mode
    --api-key <key>      Provide API key directly

  uninstall              Remove all Nia configuration
    --no-tui             Non-interactive mode
```

## Get Your API Key

Get your Nia API key at [app.trynia.ai](https://app.trynia.ai).

## License

MIT
