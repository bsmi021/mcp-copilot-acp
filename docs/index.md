# mcp-copilot-acp Documentation

Last updated: 2026-03-02

## Contents

- [Tech Spec](./tech-specs/tech-spec.xml) — Full technical specification including requirements, design, and implementation plan

## Overview

mcp-copilot-acp is an MCP server that bridges Claude Code to GitHub Copilot via the Agent Client Protocol (ACP). It exposes 6 MCP tools for one-shot prompts, persistent sessions, output comparison, and status monitoring.

## Architecture

```
Claude Code  ←→  mcp-copilot-acp  ←→  Copilot CLI
 (MCP client)     (MCP server +       (ACP agent)
                   ACP client)
```

**5 layers:**

| Layer | File | Responsibility |
|---|---|---|
| MCP Server | `src/index.ts` | Tool registration, stdio transport, shutdown |
| ACP Client | `src/acp-client.ts` | NDJSON JSON-RPC transport, message routing |
| Process Manager | `src/process-manager.ts` | Copilot spawning, crash recovery, restart |
| Session Manager | `src/session-manager.ts` | Handle-to-ID mapping, lifecycle tracking |
| Response Aggregator | `src/response-aggregator.ts` | Stream collection, prompt result assembly |

## Tool Reference

| Tool | Type | Description |
|---|---|---|
| `copilot_prompt` | One-shot | Create session, prompt, collect, destroy |
| `copilot_session_create` | Session | Create persistent session |
| `copilot_session_prompt` | Session | Prompt within existing session |
| `copilot_session_destroy` | Session | Tear down session |
| `copilot_compare` | One-shot | Prompt with timing metadata |
| `copilot_status` | Status | Process and session state |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `COPILOT_PATH` | `copilot` | Path to Copilot CLI executable |
| `COPILOT_TCP_HOST` | — | TCP host (for remote Copilot) |
| `COPILOT_TCP_PORT` | — | TCP port (for remote Copilot) |
| `COPILOT_TIMEOUT_MS` | `300000` | Prompt timeout (5 min) |
| `COPILOT_MAX_RESTARTS` | `3` | Max automatic restarts |
| `MCP_VERBOSE` | `false` | Debug logging (`1` or `true`) |

## Key References

- [README](../README.md) — Installation, configuration, and usage
- [CHANGELOG](../CHANGELOG.md) — Version history and notable changes
- [CLAUDE.md](../CLAUDE.md) — Project conventions and ACP protocol notes
- [npm package](https://www.npmjs.com/package/mcp-copilot-acp) — Published package
- [GitHub repo](https://github.com/bsmi021/mcp-copilot-acp) — Source code

## External References

- [ACP Protocol](https://agentclientprotocol.com/protocol/overview) — Agent Client Protocol specification
- [MCP SDK](https://ts.sdk.modelcontextprotocol.io/) — Model Context Protocol TypeScript SDK
- [Copilot ACP Docs](https://docs.github.com/en/copilot/reference/acp-server) — GitHub Copilot ACP server reference
