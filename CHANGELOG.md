# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GitHub Actions CI/CD workflow (`.github/workflows/publish.yml`) — auto-builds, tests, and publishes to npm on push to `main` when `package.json` version changes, using npm Trusted Publishing (OIDC) with provenance attestations

## [0.1.1] - 2026-03-02

### Fixed

- ACP session update notifications now use `sessionUpdate` as discriminator field (matches Copilot's actual protocol, not the spec)
- Copilot spawned with `--allow-all` flag for true YOLO mode (auto-approval via JSON-RPC alone was insufficient for file writes and shell commands)
- `session/new` requests now include required `mcpServers: []` parameter
- `terminal` capability sent as `true` boolean (Copilot rejects the object form `{ create: true }`)
- Permission handler now selects first available option if `allow-once` is not present, and handles parse failures gracefully

## [0.1.0] - 2026-03-02

### Added

- MCP server entry point (`src/index.ts`) with real ProcessManager and SessionManager singletons, graceful shutdown on SIGTERM/SIGINT, and stdio transport
- Configuration module (`src/config.ts`) reading env vars: `COPILOT_PATH`, `COPILOT_TCP_HOST`, `COPILOT_TCP_PORT`, `COPILOT_TIMEOUT_MS`, `COPILOT_MAX_RESTARTS`, `MCP_VERBOSE`
- Structured logger (`src/logger.ts`) writing JSON to stderr with verbose-gated debug level
- `copilot_prompt` tool — one-shot prompt: creates session, sends prompt, collects streamed response via ResponseAggregator, destroys session
- `copilot_session_create` tool — creates persistent Copilot session, registers handle in SessionManager
- `copilot_session_prompt` tool — sends prompt to existing persistent session, collects response
- `copilot_session_destroy` tool — tears down persistent session, cleans up ACP and local state
- `copilot_compare` tool — runs prompt through Copilot with timing metadata for output comparison
- `copilot_status` tool — returns process state, active sessions, and Copilot capabilities
- `AcpClient` (`src/acp-client.ts`) — NDJSON-framed JSON-RPC bidirectional transport with request correlation, notification routing, incoming request dispatching, path traversal guards, and auto-approval of permission requests
- `ProcessManager` (`src/process-manager.ts`) — Copilot child process lifecycle with lazy initialization, crash detection, automatic restart tracking, and graceful shutdown
- `SessionManager` (`src/session-manager.ts`) — in-memory handle-to-sessionId mapping with UUID handle generation, lookup, destroy, and lifecycle methods
- `ResponseAggregator` (`src/response-aggregator.ts`) — streaming notification collector assembling agent message chunks, thought chunks, tool calls, and plan updates into a PromptResult
- ACP protocol types and Zod schemas (`src/types/acp.ts`) — JSON-RPC primitives, initialize, session, prompt, content blocks, session updates, incoming requests
- MCP tool types and interfaces (`src/types/mcp.ts`) — IAcpClient, IProcessManager, ISessionManager, tool input/output types, custom error classes
- Unit tests: 52 tests across 4 test files (AcpClient 19, ProcessManager 11, SessionManager 12, ResponseAggregator 10)
- README with installation, Claude Code configuration examples, tool reference, and security notes
- Documentation index (`docs/index.md`)
