/**
 * Structured logger writing to stderr.
 * stdout is reserved for the MCP protocol (stdio transport).
 * Debug-level messages are gated by verbose mode.
 */

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/** Create a logger that writes structured JSON to stderr */
export function createLogger(verbose: boolean): Logger {
  const write = (level: string, message: string, data?: Record<string, unknown>): void => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    };
    process.stderr.write(JSON.stringify(entry) + '\n');
  };

  return {
    debug(message: string, data?: Record<string, unknown>): void {
      if (verbose) {
        write('debug', message, data);
      }
    },
    info(message: string, data?: Record<string, unknown>): void {
      write('info', message, data);
    },
    warn(message: string, data?: Record<string, unknown>): void {
      write('warn', message, data);
    },
    error(message: string, data?: Record<string, unknown>): void {
      write('error', message, data);
    },
  };
}
