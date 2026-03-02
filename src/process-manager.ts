/**
 * Copilot child process lifecycle manager.
 * Implements IProcessManager — spawns, monitors, and restarts
 * the `copilot --acp` process on demand.
 */

import type { ChildProcess } from 'node:child_process';
import spawn from 'cross-spawn';

import { AcpClient } from './acp-client.js';
import type { IAcpClient, IProcessManager } from './types/index.js';
import { ProcessStartError } from './types/index.js';

// ============================================================
// Configuration
// ============================================================

/** Configuration options for ProcessManager */
export interface ProcessManagerConfig {
  /** Path or command name for the Copilot CLI (default: "copilot") */
  copilotPath?: string;

  /** Maximum number of automatic restarts before giving up (default: 3) */
  maxRestarts?: number;

  /** Timeout in ms for graceful shutdown (default: 300000) */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<ProcessManagerConfig> = {
  copilotPath: 'copilot',
  maxRestarts: 3,
  timeoutMs: 300000,
};

/** Milliseconds to wait for graceful shutdown before force-killing */
const SHUTDOWN_GRACE_MS = 5000;

// ============================================================
// ProcessManager Implementation
// ============================================================

export class ProcessManager implements IProcessManager {
  private readonly _config: Required<ProcessManagerConfig>;
  private readonly _workingDirectoryResolver: (sessionId: string) => string;

  private _client: AcpClient | null = null;
  private _process: ChildProcess | null = null;
  private _restartCount = 0;
  private _processExited = false;

  constructor(
    config: ProcessManagerConfig = {},
    workingDirectoryResolver: (sessionId: string) => string,
  ) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._workingDirectoryResolver = workingDirectoryResolver;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Ensure Copilot is running. If the process is already alive,
   * returns the existing AcpClient. Otherwise spawns a new process.
   */
  async ensure(): Promise<IAcpClient> {
    if (this._client && this.isAlive()) {
      return this._client;
    }

    if (this._restartCount >= this._config.maxRestarts && this._processExited) {
      throw new ProcessStartError(
        `Copilot process has crashed ${this._restartCount} times, exceeding ` +
        `the maximum of ${this._config.maxRestarts} restarts`,
      );
    }

    return this._spawn();
  }

  /** Check if the child process is currently running. */
  isAlive(): boolean {
    return this._process !== null && !this._processExited;
  }

  /** Gracefully shut down the Copilot process. */
  async shutdown(): Promise<void> {
    if (!this._process) {
      return;
    }

    const proc = this._process;
    const client = this._client;

    // Signal EOF by closing stdin
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.end();
    }

    // Wait for the process to exit or force-kill after grace period
    await this._waitForExitOrKill(proc);

    // Clean up the ACP client
    if (client) {
      client.destroy();
    }

    this._client = null;
    this._process = null;
  }

  // ============================================================
  // Internal: Spawning
  // ============================================================

  /** Spawn the Copilot process and initialize the ACP client. */
  private async _spawn(): Promise<AcpClient> {
    const proc = this._spawnProcess();
    this._process = proc;
    this._processExited = false;

    this._attachExitHandler(proc);

    const client = new AcpClient(
      proc.stdout!,
      proc.stdin!,
      this._workingDirectoryResolver,
    );

    await client.initialize();
    this._client = client;
    return client;
  }

  /** Spawn the child process with cross-spawn. */
  private _spawnProcess(): ChildProcess {
    let proc: ChildProcess;
    try {
      proc = spawn(this._config.copilotPath, ['--acp', '--allow-all'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProcessStartError(
        `Failed to spawn "${this._config.copilotPath} --acp": ${message}. ` +
        'Ensure the Copilot CLI is installed and available on your PATH.',
      );
    }

    // Handle spawn errors (e.g., command not found)
    proc.on('error', (err: Error) => {
      this._processExited = true;
      this._process = null;
      if (this._client) {
        this._client.destroy();
        this._client = null;
      }
      // Re-throw as ProcessStartError if it's ENOENT
      if ('code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Error already captured; ensure() will throw on next call
      }
    });

    if (!proc.stdin || !proc.stdout) {
      throw new ProcessStartError(
        'Failed to create stdio pipes for Copilot process',
      );
    }

    return proc;
  }

  /** Attach exit handler to track process lifecycle. */
  private _attachExitHandler(proc: ChildProcess): void {
    proc.on('exit', () => {
      this._processExited = true;
      this._restartCount++;

      // Clean up client references without destroying
      // (destroy is handled in ensure() or shutdown())
      if (this._client) {
        this._client.destroy();
        this._client = null;
      }
      this._process = null;
    });
  }

  /** Wait for process to exit within grace period, then force-kill. */
  private async _waitForExitOrKill(proc: ChildProcess): Promise<void> {
    return new Promise<void>((resolve) => {
      let resolved = false;
      const doResolve = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve();
        }
      };

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        doResolve();
      }, SHUTDOWN_GRACE_MS);
      // Ensure the timer does not prevent Node from exiting
      if (timer && typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }

      proc.on('exit', doResolve);

      // If process is already dead, resolve immediately
      if (proc.exitCode !== null || proc.signalCode !== null) {
        doResolve();
      }
    });
  }
}
