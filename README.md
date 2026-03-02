# mcp-copilot-acp

MCP server that bridges Claude Code to GitHub Copilot via the Agent Client Protocol (ACP). Enables Claude Code to delegate coding tasks, chain agent workflows, and compare outputs by orchestrating Copilot through standardized MCP tool calls.

## Architecture

```
┌─────────────┐     MCP (stdio)     ┌──────────────────┐     ACP (stdio/TCP)     ┌─────────────┐
│ Claude Code │ ◄──────────────────► │ mcp-copilot-acp  │ ◄──────────────────────► │ Copilot CLI │
│ (MCP Client)│    tool calls/results│ (MCP Server +    │   JSON-RPC 2.0          │ (ACP Agent) │
└─────────────┘                      │  ACP Client)     │   session/prompt/update  └─────────────┘
                                     └──────────────────┘
```

## Prerequisites

- **Node.js 22 LTS** (22.22.0+)
- **GitHub Copilot CLI** installed and authenticated (`copilot` on PATH)
- **Claude Code** installed

## Installation

### Quick Start (npx)

Add to Claude Code with a single command:

```bash
# macOS / Linux
claude mcp add --transport stdio copilot-bridge -- npx -y mcp-copilot-acp

# Windows
claude mcp add --transport stdio copilot-bridge -- cmd /c npx -y mcp-copilot-acp
```

### Manual Configuration

Add to your Claude Code MCP settings (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "copilot-bridge": {
      "command": "npx",
      "args": ["-y", "mcp-copilot-acp"],
      "transport": "stdio"
    }
  }
}
```

On Windows:

```json
{
  "mcpServers": {
    "copilot-bridge": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "mcp-copilot-acp"],
      "transport": "stdio"
    }
  }
}
```

## MCP Tools

| Tool | Description |
|---|---|
| `copilot_prompt` | One-shot: create session, prompt Copilot, collect response, destroy session |
| `copilot_session_create` | Create a persistent session for multi-turn conversations |
| `copilot_session_prompt` | Send a prompt to an existing persistent session |
| `copilot_session_destroy` | Tear down a persistent session |
| `copilot_compare` | Run a prompt through Copilot and return response with timing metadata |
| `copilot_status` | Check process status, list active sessions, view capabilities |

### Tool Parameters

**copilot_prompt**
- `prompt` (string, required) — The prompt text to send
- `workingDirectory` (string, optional) — Working directory for Copilot
- `context` (string, optional) — Additional context to include

**copilot_session_create**
- `workingDirectory` (string, optional) — Working directory for Copilot
- `name` (string, optional) — Human-readable session name

**copilot_session_prompt**
- `sessionHandle` (string, required) — Handle from `copilot_session_create`
- `prompt` (string, required) — The prompt text
- `context` (string, optional) — Additional context

**copilot_session_destroy**
- `sessionHandle` (string, required) — Handle to destroy

**copilot_compare**
- `prompt` (string, required) — The prompt to run
- `workingDirectory` (string, optional) — Working directory for Copilot

**copilot_status**
- No parameters

## Configuration

All settings are via environment variables:

| Variable | Default | Description |
|---|---|---|
| `COPILOT_PATH` | `copilot` | Path to Copilot CLI executable |
| `COPILOT_TCP_HOST` | — | TCP host (for connecting to running Copilot) |
| `COPILOT_TCP_PORT` | — | TCP port (for connecting to running Copilot) |
| `COPILOT_TIMEOUT_MS` | `300000` | Prompt timeout in milliseconds (5 min) |
| `COPILOT_MAX_RESTARTS` | `3` | Max automatic restarts on crash |
| `MCP_VERBOSE` | `false` | Enable debug logging (`1` or `true`) |

## Security

- **Path traversal protection**: All file system operations from Copilot are scoped to the session working directory. Path traversal attempts (e.g., `../../../etc/passwd`) are rejected.
- **YOLO mode**: All Copilot permission requests are auto-approved. This is appropriate for local development use. Do not use in untrusted environments.
- **Logging**: All ACP messages can be traced with `MCP_VERBOSE=1` for debugging. Logs go to stderr (stdout reserved for MCP protocol).

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build

# Watch mode (TypeScript)
npm run dev
```

## Project Structure

```
src/
  index.ts              # MCP server setup + stdio transport
  acp-client.ts         # ACP JSON-RPC client (stdio transport)
  process-manager.ts    # Copilot child process spawning and recovery
  session-manager.ts    # Session lifecycle and handle-to-ID mapping
  response-aggregator.ts # Stream collection from session/update notifications
  config.ts             # Environment variable configuration
  logger.ts             # Structured stderr logging
  tools/                # MCP tool definitions and handlers
    copilot-prompt.ts
    copilot-session.ts
    copilot-compare.ts
    copilot-status.ts
  types/                # Shared TypeScript types and Zod schemas
    acp.ts              # ACP protocol message types
    mcp.ts              # MCP tool input/output types
    index.ts            # Re-exports
```

## License

MIT
