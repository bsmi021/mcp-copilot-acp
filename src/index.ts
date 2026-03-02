#!/usr/bin/env node

/**
 * MCP server entry point for mcp-copilot-acp.
 * Bridges Claude Code to GitHub Copilot via the Agent Client Protocol (ACP).
 *
 * Architecture:
 * - Creates real ProcessManager and SessionManager singletons
 * - Registers 6 MCP tools (prompt, session CRUD, compare, status)
 * - Connects via stdio transport for use with Claude Code
 * - Handles graceful shutdown on SIGTERM/SIGINT
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { ProcessManager } from './process-manager.js';
import { SessionManager } from './session-manager.js';
import type { ToolDeps } from './types/index.js';

import { copilotStatusHandler } from './tools/copilot-status.js';
import { copilotPromptHandler } from './tools/copilot-prompt.js';
import {
  copilotSessionCreateHandler,
  copilotSessionPromptHandler,
  copilotSessionDestroyHandler,
} from './tools/copilot-session.js';
import { copilotCompareHandler } from './tools/copilot-compare.js';
import {
  CopilotPromptInputSchema,
  CopilotSessionCreateInputSchema,
  CopilotSessionPromptInputSchema,
  CopilotSessionDestroyInputSchema,
  CopilotCompareInputSchema,
} from './types/index.js';

// ============================================================
// MCP Content Formatting
// ============================================================

/** Format a successful tool result as MCP content. */
function formatResult(result: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}

/** Format an error as MCP error content. */
function formatError(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

// ============================================================
// Tool Registration
// ============================================================

/** Register all 6 MCP tools on the server instance. */
function registerTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'copilot_prompt',
    'Send a one-shot prompt to GitHub Copilot. Creates a session, sends the prompt, collects the response, and destroys the session.',
    CopilotPromptInputSchema.shape,
    async (input) => {
      try {
        const result = await copilotPromptHandler(input, deps);
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    'copilot_session_create',
    'Create a persistent Copilot session for multi-turn conversations. Returns a session handle for subsequent prompts.',
    CopilotSessionCreateInputSchema.shape,
    async (input) => {
      try {
        const result = await copilotSessionCreateHandler(input, deps);
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    'copilot_session_prompt',
    'Send a prompt to an existing persistent Copilot session. Requires a session handle from copilot_session_create.',
    CopilotSessionPromptInputSchema.shape,
    async (input) => {
      try {
        const result = await copilotSessionPromptHandler(input, deps);
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    'copilot_session_destroy',
    'Destroy a persistent Copilot session and free associated resources.',
    CopilotSessionDestroyInputSchema.shape,
    async (input) => {
      try {
        const result = await copilotSessionDestroyHandler(input, deps);
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    'copilot_compare',
    'Run a prompt through GitHub Copilot and return the response with timing metadata. Useful for comparing outputs.',
    CopilotCompareInputSchema.shape,
    async (input) => {
      try {
        const result = await copilotCompareHandler(input, deps);
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    'copilot_status',
    'Check if Copilot ACP process is running and list active sessions.',
    {},
    async () => {
      try {
        const result = await copilotStatusHandler({}, deps);
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );
}

// ============================================================
// Main Entry Point
// ============================================================

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.verbose);

  logger.info('Starting mcp-copilot-acp server', {
    copilotPath: config.copilotPath,
    timeoutMs: config.timeoutMs,
    maxRestarts: config.maxRestarts,
    verbose: config.verbose,
  });

  // Create real singletons
  const sessionManager = new SessionManager();

  const processManager = new ProcessManager(
    {
      copilotPath: config.copilotPath,
      maxRestarts: config.maxRestarts,
      timeoutMs: config.timeoutMs,
    },
    (sessionId: string) => {
      const session = sessionManager.lookupBySessionId(sessionId);
      return session?.workingDirectory ?? process.cwd();
    },
  );

  const deps: ToolDeps = { processManager, sessionManager };

  // Create and configure MCP server
  const server = new McpServer({
    name: 'mcp-copilot-acp',
    version: '0.1.0',
  });

  registerTools(server, deps);

  // Graceful shutdown handler
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down mcp-copilot-acp server');
    sessionManager.clear();
    await processManager.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  // Connect and serve
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('MCP server connected via stdio transport');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
