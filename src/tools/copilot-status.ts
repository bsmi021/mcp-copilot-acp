/**
 * copilot_status tool — Check if Copilot ACP process is running
 * and list active sessions.
 *
 * Fully implemented (reads state only, no ACP calls needed).
 */

import type { ToolDeps, StatusResult } from '../types/index.js';

/** Schema for server.tool() — empty Zod raw shape (no input parameters). */
export const copilotStatusSchema = {};

/**
 * Handler for the copilot_status tool.
 * Returns process state, active sessions, and Copilot capabilities.
 */
export async function copilotStatusHandler(
  _input: Record<string, never>,
  deps: ToolDeps,
): Promise<StatusResult> {
  const sessions = deps.sessionManager.listAll().map((s) => ({
    handle: s.handle,
    sessionId: s.sessionId,
    name: s.name,
    workingDirectory: s.workingDirectory,
    createdAt: s.createdAt.toISOString(),
  }));

  // Read capabilities from the ACP client if process is running
  let capabilities = null;
  if (deps.processManager.isAlive()) {
    try {
      const client = await deps.processManager.ensure();
      capabilities = client.capabilities;
    } catch {
      // Process may have died between isAlive() and ensure()
    }
  }

  return {
    processRunning: deps.processManager.isAlive(),
    sessions,
    capabilities,
  };
}
