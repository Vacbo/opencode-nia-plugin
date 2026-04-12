# nia-opencode

Installer and plugin for integrating [Nia Knowledge Agent](https://trynia.ai) with [OpenCode](https://opencode.ai). Provides research, documentation lookup, and codebase exploration capabilities.

## How It Works

The installer detects your OpenCode version and chooses the best integration method:

| OpenCode Version | Integration | How Nia Tools Are Delivered |
| ---------------- | ----------- | --------------------------- |
| **>= v1.1.50** | Native Plugin | `@vacbo/opencode-nia-plugin` — tools registered via `@opencode-ai/plugin` SDK |
| **>= v1.1.50** | [Agent Skills](https://opencode.ai/docs/skills) (alternative) | Installs [nia-skill](https://github.com/nozomio-labs/nia-skill) via `npx skills add` — bash scripts calling Nia's REST API |
| **< v1.1.50** | MCP (legacy) | Registers Nia MCP server + keyword detection plugin |

## Installation

```bash
bunx nia-opencode@latest install
```

The installer will:

1. Detect your OpenCode version
2. Prompt for your Nia API key
3. Store the API key at `~/.config/nia/api_key`
4. Install the native plugin (recommended), the agent skill (alternative), or configure MCP server + plugin (legacy)
5. Clean up any outdated configuration from previous installs

### Non-Interactive Installation

```bash
bunx nia-opencode@latest install --no-tui --api-key nk_your_api_key
```

### Uninstall

```bash
bunx nia-opencode@latest uninstall
```

Removes all Nia configuration: skill files, MCP server entries, plugin entries, instructions references, API keys, and any legacy AGENTS.md content.

## Native Plugin Path (Recommended)

On modern OpenCode versions, the recommended path is the native plugin. It registers Nia tools directly through the `@opencode-ai/plugin` SDK, so no MCP server is needed.

This keeps the integration inside OpenCode itself, reduces overhead, and exposes Nia tools as native plugin tools instead of MCP-connected tools.

### Configure `opencode.json`

Add the plugin package to the `plugin` array:

```json
{
  "plugin": ["@vacbo/opencode-nia-plugin@latest"]
}
```

Add the Nia workflow guide to the `instructions` array:

```json
{
  "instructions": [
    "https://raw.githubusercontent.com/nozomio-labs/nia-opencode/main/instructions/nia-mcp-instructions.md"
  ]
}
```

Store your API key in `~/.config/opencode/nia.json`:

```json
{
  "apiKey": "nk_your_api_key",
  "keywords": {
    "enabled": true
  }
}
```

### Available Native Tools

| Tool | Description |
| ---- | ----------- |
| `nia_search` | Semantic search across indexed repos, docs, and papers |
| `nia_read` | Read file content from indexed sources |
| `nia_grep` | Search indexed code and docs with grep |
| `nia_explore` | Browse indexed file trees |
| `nia_index` | Index repositories, docs, and papers |
| `nia_manage_resource` | List, inspect, rename, subscribe to, or delete indexed resources |
| `nia_research` | Run quick, deep, or oracle web research |
| `nia_advisor` | Context-aware code analysis against indexed docs |
| `nia_context` | Save, retrieve, search, and manage reusable context |
| `nia_package_search` | Search npm, PyPI, crates.io, and Go package source code |
| `nia_auto_subscribe` | Subscribe to dependency docs from project manifests |
| `nia_tracer` | Search GitHub repositories without indexing |
| `nia_e2e` | Manage E2E encrypted local folder sessions |
| `nia_write` | Create or update a file in an indexed source |
| `nia_rm` | Delete a file from an indexed source |
| `nia_mv` | Move or rename a file in an indexed source |
| `nia_mkdir` | Create a directory in an indexed source |

## Agent Skills Path (OpenCode >= v1.1.50)

On latest OpenCode versions, the installer runs:

```bash
npx skills add nozomio-labs/nia-skill -g -a opencode -y
```

This installs the [nia-skill](https://github.com/nozomio-labs/nia-skill) globally for OpenCode. The agent automatically discovers it through the built-in `skill` tool and loads it on-demand when relevant.

No MCP server or plugin is needed — the skill provides bash scripts that call Nia's REST API directly. The scripts read your API key from `~/.config/nia/api_key`, which the installer stores automatically.

### What You Can Do

Once installed, the agent can:

- Index and search GitHub repositories, documentation sites, and arXiv papers
- Perform web search and deep AI-powered research
- Read files, grep code, and explore file trees across indexed sources
- Search npm, PyPI, crates.io, and Go package source code
- Save and share context across agents (Cursor, Claude Code, Windsurf, etc.)
- Analyze dependencies from manifest files

See the [nia-skill README](https://github.com/nozomio-labs/nia-skill) for full documentation.

### Manual Setup

If you prefer to set things up manually instead of using the installer:

1. **Store your API key:**

```bash
mkdir -p ~/.config/nia
echo "nk_your_api_key" > ~/.config/nia/api_key
```

1. **Install the skill:**

```bash
npx skills add nozomio-labs/nia-skill -g -a opencode -y
```

1. **Ensure `curl` and `jq` are installed** (required by the nia-skill bash scripts).

## MCP Path (Legacy, OpenCode < v1.1.50)

On older OpenCode versions, the installer configures three things:

### 1. MCP Server

Adds a remote Nia MCP server to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "nia": {
      "type": "remote",
      "url": "https://apigcp.trynia.ai/mcp",
      "headers": {
        "Authorization": "Bearer nk_your_api_key"
      },
      "oauth": false
    }
  }
}
```

### 2. Plugin (Keyword Detection)

Registers the `nia-opencode` plugin which hooks into `chat.message` events. When the user says things like:

- "Research how React hooks work"
- "Look up the Next.js documentation"
- "Search the codebase for authentication"
- "Find docs for Prisma migrations"
- "Grep for error handling patterns"
- "Index this repo"

...the plugin injects a nudge telling the agent to use the Nia tools.

### 3. Remote Instructions

Adds a remote instructions URL to the `instructions` config array, providing the agent with a Nia-first workflow guide.

### Available MCP Tools

| Tool                  | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `nia_search`          | Semantic search across indexed repos, docs, papers   |
| `nia_research`        | Web search (quick) or deep AI research (deep/oracle) |
| `nia_index`           | Index GitHub repos, docs sites, or arXiv papers      |
| `nia_read`            | Read files from indexed sources                      |
| `nia_grep`            | Regex search across codebases                        |
| `nia_explore`         | Browse file trees                                    |
| `nia_manage_resource` | List/manage indexed sources                          |
| `nia_context`         | Save/load cross-agent context                        |

### Legacy Configuration

#### `~/.config/opencode/nia.json`

```json
{
  "apiKey": "nk_...",
  "keywords": {
    "enabled": true,
    "patterns": ["my custom pattern"]
  }
}
```

| Option              | Default | Description                              |
| ------------------- | ------- | ---------------------------------------- |
| `apiKey`            | -       | Your Nia API key                         |
| `keywords.enabled`  | `true`  | Enable/disable keyword detection         |
| `keywords.patterns` | `[]`    | Additional regex patterns to trigger Nia |

#### Debugging

```bash
NIA_DEBUG=true opencode
```

#### Plugin Connection Resilience

The plugin automatically monitors Nia tool connections and attempts reconnection on failures.
This handles "Failed to get tools" errors, network timeouts, and connection drops.

| Environment Variable | Default | Description |
| --- | --- | --- |
| `NIA_MCP_SERVER_NAME` | `nia` | Name of the MCP server to monitor (matches key in opencode.json mcp config) |
| `NIA_MCP_MAX_RETRIES` | `5` | Maximum reconnection attempts before circuit breaker opens |
| `NIA_MCP_RECONNECT_DELAY` | `100` | Initial backoff delay in ms (doubles each attempt, max 30s) |

**How it works:**
- **Network Retry**: The NiaClient automatically retries transient network errors (ECONNREFUSED, DNS failures, etc.) with exponential backoff up to 3 times
- **Circuit Breaker**: If reconnection fails 5 times (configurable), the circuit opens for 30 seconds to prevent retry storms
- **Best-Effort Reconnection**: When a tool call fails with a connection error, the plugin checks server status and attempts to reconnect
- **Debounced**: Multiple simultaneous failures trigger only one reconnection attempt

**Actionable Error Messages:**
When errors occur, you'll now see helpful guidance:
- **Credit exhaustion** (403): "⚠️ Your Nia credits may be exhausted... Check your usage at https://app.trynia.ai"
- **Rate limiting** (429): "Nia API rate limit hit. The request will be retried automatically."
- **Auth error** (401): "Nia API key is invalid or expired. Update your key at ~/.config/nia/api_key"
- **Network error**: "Unable to reach Nia API. Check your network connection."

**E2E Encryption Tools:**
All E2E encryption tools (`nia_e2e` with create_session, get_session, purge, sync) automatically benefit from:
- Network error retry with exponential backoff
- Actionable error messages for all error types
- No additional configuration needed

**Limitation:**
The failed tool call itself still returns an error to the agent. The agent will typically retry the call, and the next attempt will succeed after reconnection. The reconnection happens in the background and doesn't block the agent's workflow.

### Manual Setup (Legacy)

For modern installations, use the Native Plugin path instead — no MCP server needed.

If you prefer to set things up manually instead of using the installer:

1. **Store your API key**

```bash
cat > ~/.config/opencode/nia.json << 'EOF'
{
  "apiKey": "nk_your_api_key",
  "keywords": {
    "enabled": true
  }
}
EOF
```

1. **Add the following to your `~/.config/opencode/opencode.json`:**

```json
{
  "plugin": ["nia-opencode@latest"],
  "instructions": [
    "https://raw.githubusercontent.com/nozomio-labs/nia-opencode/main/instructions/nia-mcp-instructions.md"
  ],
  "mcp": {
    "nia": {
      "type": "remote",
      "url": "https://apigcp.trynia.ai/mcp",
      "headers": {
        "Authorization": "Bearer <nk_your_api_key>"
      },
      "oauth": false
    }
  }
}
```

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

Get your Nia API key at [app.trynia.ai](https://app.trynia.ai)

## License

MIT
