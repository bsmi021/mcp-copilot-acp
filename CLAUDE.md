# mcp-copilot-acp

MCP server that bridges Claude Code to GitHub Copilot via the Agent Client Protocol (ACP).
Enables Claude Code to delegate coding tasks, chain agent workflows, and compare outputs
by orchestrating Copilot through standardized MCP tool calls.

## Architecture

```
┌─────────────┐     MCP (stdio)     ┌──────────────────┐     ACP (stdio/TCP)     ┌─────────────┐
│ Claude Code │ ◄──────────────────► │ mcp-copilot-acp  │ ◄──────────────────────► │ Copilot CLI │
│ (MCP Client)│    tool calls/results│ (MCP Server +    │   JSON-RPC 2.0          │ (ACP Agent) │
└─────────────┘                      │  ACP Client)     │   session/prompt/update  └─────────────┘
                                     └──────────────────┘
```

**Pattern**: Pure stdio MCP server distributed via npm/npx. Not a CLI tool, not a Docker container.

**Components** (5 layers):
1. **MCP Server Layer** — @modelcontextprotocol/sdk, stdio transport, tool definitions
2. **ACP Client Layer** — JSON-RPC 2.0 bidirectional communication with Copilot
3. **Session Manager** — Tracks active sessions, handle-to-ID mapping, lifecycle
4. **Process Manager** — Spawns copilot --acp, lazy init, crash detection, restart
5. **Response Aggregator** — Collects streaming session/update notifications into results

## Technology Stack

| Dependency | Version | Purpose |
|---|---|---|
| @modelcontextprotocol/sdk | ^1.27.1 | MCP server framework (use v1.x, NOT v2 pre-alpha) |
| zod | ^3.25.76 | Tool input schema validation (required MCP SDK peer dep) |
| cross-spawn | ^7.0.6 | Cross-platform child process spawning |
| typescript | ^5.9.3 | Compiler (devDependency) |
| vitest | ^4.0.18 | Test runner (devDependency) |
| @types/node | ^22.19.13 | Node.js types for LTS 22 (devDependency) |

**Runtime**: Node.js 22 LTS (22.22.0+)
**ACP Protocol Version**: 2025-09-01

## Project Conventions

### TypeScript
- `strict: true` in tsconfig — no exceptions
- Do not use `any` type — use specific types, interfaces, and Zod schemas
- Use Zod for all runtime validation (tool inputs, ACP message parsing)
- ESM only — `"type": "module"` in package.json
- Module: `NodeNext`, target: `ES2022`

### Project Structure
```
src/
  index.ts              # Entry point — MCP server setup + stdio transport
  acp-client.ts         # ACP JSON-RPC client (NDJSON over stdio)
  process-manager.ts    # Copilot child process spawning and recovery
  session-manager.ts    # Session lifecycle and handle-to-ID mapping
  response-aggregator.ts # Stream collection from session/update notifications
  config.ts             # Environment variable configuration
  logger.ts             # Structured stderr logging (JSON format)
  tools/                # MCP tool definitions and handlers
    copilot-prompt.ts
    copilot-session.ts
    copilot-compare.ts
    copilot-status.ts
  types/                # Shared TypeScript types and Zod schemas
    acp.ts              # ACP protocol message types
    mcp.ts              # MCP tool input/output types
    index.ts            # Re-exports
dist/                   # Compiled output (gitignored)
prototypes/             # Prototype apps (gitignored, not published)
```

### File and Code Limits
- All source files under 500 LOC (excluding comments/whitespace)
- All functions under 50 LOC (excluding comments/whitespace)

### Testing
- Vitest for all tests
- Unit tests for: JSON-RPC serialization, response aggregator, session manager, path safety
- Integration tests against live `copilot --acp` process
- Test files co-located: `src/**/*.test.ts`

### Distribution
- npm package: `mcp-copilot-acp`
- Entry: `dist/index.js` with `#!/usr/bin/env node` shebang
- Install: `claude mcp add --transport stdio copilot-bridge -- npx -y mcp-copilot-acp`
- Windows: `claude mcp add --transport stdio copilot-bridge -- cmd /c npx -y mcp-copilot-acp`

## Key Design Decisions

1. **TypeScript/Node.js** — MCP SDK is TypeScript-native; ACP is JSON-RPC (trivial in Node)
2. **Stdio primary, TCP optional** — Stdio is zero-config (we spawn Copilot), TCP for advanced use
3. **Lazy initialization** — Don't start Copilot until first tool call
4. **YOLO mode default** — Copilot spawned with `--allow-all` flag AND JSON-RPC permission auto-approval (both layers required)
5. **npx distribution** — Standard MCP server pattern; always-latest, zero-friction setup
6. **Zod schemas** — Required by MCP SDK; use for both tool inputs and ACP message validation
7. **Focused tool surface** — 6 tools (not 22 like MCACP); purpose-built for Copilot workflow

## ACP Protocol Notes (Discovered During Implementation)

These diverge from the ACP spec and reflect Copilot's actual behavior:

- **Session update discriminator**: Copilot uses `sessionUpdate` as the discriminator field in `session/update` notifications, not `type` as documented in the ACP spec
- **YOLO requires `--allow-all`**: JSON-RPC `session/request_permission` auto-approval alone is NOT sufficient — Copilot has a separate CLI-level permission system controlled by the `--allow-all` flag
- **`session/new` requires `mcpServers`**: The `mcpServers: []` parameter is required even when empty
- **`terminal` capability**: Must be sent as `true` boolean, not `{ create: true }` object form
- **`session/destroy` not supported**: Returns `-32601 Method not found` — sessions clean up on process exit
- **`tool_call_update` with `rawOutput`**: Copilot sends `rawOutput` in tool call updates which doesn't match the `ContentBlock` schema — parse failures for these are benign

## MCP Tools Exposed

| Tool | Purpose |
|---|---|
| `copilot_prompt` | One-shot: create session, prompt, collect response, destroy |
| `copilot_session_create` | Create a persistent session |
| `copilot_session_prompt` | Send prompt to existing persistent session |
| `copilot_session_destroy` | Tear down persistent session |
| `copilot_compare` | Run same prompt through Copilot for comparison |
| `copilot_status` | Check server/session/process status |

## Competitive Context

**MCACP** (Oortonaut/mcacp) is a general-purpose MCP-to-ACP bridge with 22 tools supporting
any ACP agent. Our differentiator: purpose-built for the Claude Code + Copilot workflow with
a simpler, focused tool surface and zero-config startup.

## Distribution

- **npm**: https://www.npmjs.com/package/mcp-copilot-acp
- **GitHub**: https://github.com/bsmi021/mcp-copilot-acp
- **Install**: `npx -y mcp-copilot-acp` (or see README for Claude Code config)

## References

- Tech spec: `docs/tech-specs/tech-spec.xml`
- MCP SDK docs: https://ts.sdk.modelcontextprotocol.io/
- ACP protocol: https://agentclientprotocol.com/protocol/overview
- Copilot ACP docs: https://docs.github.com/en/copilot/reference/acp-server
- MCACP (competitor): https://github.com/Oortonaut/mcacp

## copyright on all code files and markdown files in this project
© 2026 Brian W. Smith. All rights reserved. This project is licensed under the MIT License.