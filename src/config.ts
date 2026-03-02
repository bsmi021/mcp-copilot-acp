/**
 * Configuration module for mcp-copilot-acp.
 * Reads settings from environment variables with sensible defaults.
 */

/** Server configuration */
export interface Config {
  /** Path to the copilot CLI executable (default: "copilot") */
  copilotPath: string;

  /** TCP host for connecting to an already-running Copilot ACP server */
  tcpHost: string | undefined;

  /** TCP port for connecting to an already-running Copilot ACP server */
  tcpPort: number | undefined;

  /** Timeout in milliseconds for each prompt (default: 300000 = 5 minutes) */
  timeoutMs: number;

  /** Maximum number of automatic restarts on crash (default: 3) */
  maxRestarts: number;

  /** Enable verbose debug logging (default: false) */
  verbose: boolean;
}

/** Load configuration from environment variables */
export function loadConfig(): Config {
  const tcpPortStr = process.env['COPILOT_TCP_PORT'];
  const tcpPort = tcpPortStr ? parseInt(tcpPortStr, 10) : undefined;

  const timeoutStr = process.env['COPILOT_TIMEOUT_MS'];
  const timeoutMs = timeoutStr ? parseInt(timeoutStr, 10) : 300_000;

  const maxRestartsStr = process.env['COPILOT_MAX_RESTARTS'];
  const maxRestarts = maxRestartsStr ? parseInt(maxRestartsStr, 10) : 3;

  return {
    copilotPath: process.env['COPILOT_PATH'] ?? 'copilot',
    tcpHost: process.env['COPILOT_TCP_HOST'],
    tcpPort: Number.isNaN(tcpPort) ? undefined : tcpPort,
    timeoutMs: Number.isNaN(timeoutMs) ? 300_000 : timeoutMs,
    maxRestarts: Number.isNaN(maxRestarts) ? 3 : maxRestarts,
    verbose: process.env['MCP_VERBOSE'] === '1' || process.env['MCP_VERBOSE'] === 'true',
  };
}
