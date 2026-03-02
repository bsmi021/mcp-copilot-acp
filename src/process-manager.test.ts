/**
 * Unit tests for ProcessManager.
 * Mocks cross-spawn to avoid needing a real Copilot CLI.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

// ============================================================
// Mock cross-spawn
// ============================================================

/**
 * Mock ChildProcess that extends EventEmitter to support .on('exit')
 * and exposes PassThrough streams for stdin/stdout/stderr.
 */
class MockChildProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: string | null = null;
  pid = 12345;

  kill(_signal?: string): boolean {
    this.exitCode = 1;
    this.emit('exit', 1, null);
    return true;
  }
}

/** Factory to create a mock child process that sends an initialize response */
function createMockProcess(): MockChildProcess {
  const proc = new MockChildProcess();

  // Simulate Copilot responding to the initialize request
  // The client will write to proc.stdin; Copilot responds on proc.stdout.
  // We listen to stdin to detect the initialize request and respond on stdout.
  let stdinBuffer = '';
  proc.stdin.on('data', (chunk: Buffer | string) => {
    stdinBuffer += chunk.toString();
    const newlineIdx = stdinBuffer.indexOf('\n');
    if (newlineIdx >= 0) {
      const line = stdinBuffer.slice(0, newlineIdx);
      stdinBuffer = stdinBuffer.slice(newlineIdx + 1);

      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (msg['method'] === 'initialize') {
          const response = JSON.stringify({
            jsonrpc: '2.0',
            id: msg['id'],
            result: {
              protocolVersion: 1,
              agentCapabilities: { streaming: true },
              agentInfo: { name: 'copilot-mock', version: '1.0.0' },
            },
          }) + '\n';
          proc.stdout.write(response);
        }
      } catch {
        // Ignore parse errors in test
      }
    }
  });

  return proc;
}

// Mock cross-spawn module before importing ProcessManager
vi.mock('cross-spawn', () => {
  const mockSpawn = vi.fn() as Mock;
  return { default: mockSpawn };
});

// Import after mocking
import spawn from 'cross-spawn';
import { ProcessManager } from './process-manager.js';
import { ProcessStartError } from './types/index.js';

const mockSpawn = spawn as unknown as Mock;

// ============================================================
// Tests
// ============================================================

describe('ProcessManager', () => {
  const workingDirResolver = (_sessionId: string) => '/test/project';

  beforeEach(() => {
    mockSpawn.mockReset();
  });

  // ----------------------------------------------------------
  // Lazy Initialization
  // ----------------------------------------------------------

  describe('lazy initialization', () => {
    it('spawns process on first ensure() call', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const pm = new ProcessManager({}, workingDirResolver);
      const client = await pm.ensure();

      expect(mockSpawn).toHaveBeenCalledOnce();
      expect(mockSpawn).toHaveBeenCalledWith('copilot', ['--acp', '--allow-all'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(client).toBeDefined();
      expect(client.capabilities).toEqual({ streaming: true });
    });

    it('reuses existing process on second ensure() call', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const pm = new ProcessManager({}, workingDirResolver);
      const client1 = await pm.ensure();
      const client2 = await pm.ensure();

      expect(mockSpawn).toHaveBeenCalledOnce();
      expect(client1).toBe(client2);
    });
  });

  // ----------------------------------------------------------
  // isAlive
  // ----------------------------------------------------------

  describe('isAlive', () => {
    it('returns false before first ensure()', () => {
      const pm = new ProcessManager({}, workingDirResolver);
      expect(pm.isAlive()).toBe(false);
    });

    it('returns true after successful ensure()', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const pm = new ProcessManager({}, workingDirResolver);
      await pm.ensure();
      expect(pm.isAlive()).toBe(true);
    });

    it('returns false after process exits', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const pm = new ProcessManager({}, workingDirResolver);
      await pm.ensure();
      expect(pm.isAlive()).toBe(true);

      // Simulate process exit
      proc.exitCode = 1;
      proc.emit('exit', 1, null);

      expect(pm.isAlive()).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // Restart Tracking
  // ----------------------------------------------------------

  describe('restart tracking', () => {
    it('respawns after process exit', async () => {
      const proc1 = createMockProcess();
      const proc2 = createMockProcess();
      mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);

      const pm = new ProcessManager({ maxRestarts: 3 }, workingDirResolver);

      await pm.ensure();
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      // Simulate crash
      proc1.exitCode = 1;
      proc1.emit('exit', 1, null);

      // Next ensure() should spawn again
      await pm.ensure();
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('throws ProcessStartError when max restarts exceeded', async () => {
      const processes = Array.from({ length: 4 }, () => createMockProcess());
      for (const p of processes) {
        mockSpawn.mockReturnValueOnce(p);
      }

      const pm = new ProcessManager({ maxRestarts: 3 }, workingDirResolver);

      // Spawn and crash 3 times
      for (let i = 0; i < 3; i++) {
        await pm.ensure();
        processes[i].exitCode = 1;
        processes[i].emit('exit', 1, null);
      }

      // Fourth ensure() should throw
      await expect(pm.ensure()).rejects.toThrow(ProcessStartError);
      await expect(pm.ensure()).rejects.toThrow(/exceeding the maximum of 3 restarts/);
    });
  });

  // ----------------------------------------------------------
  // Shutdown
  // ----------------------------------------------------------

  describe('shutdown', () => {
    it('closes stdin and cleans up', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const pm = new ProcessManager({}, workingDirResolver);
      await pm.ensure();
      expect(pm.isAlive()).toBe(true);

      // Set exitCode so _waitForExitOrKill resolves immediately
      proc.exitCode = 0;

      await pm.shutdown();
      expect(pm.isAlive()).toBe(false);
    });

    it('is a no-op when no process is running', async () => {
      const pm = new ProcessManager({}, workingDirResolver);
      // Should not throw
      await pm.shutdown();
    });
  });

  // ----------------------------------------------------------
  // Spawn Failure
  // ----------------------------------------------------------

  describe('spawn failure', () => {
    it('throws ProcessStartError when spawn throws', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('spawn ENOENT');
      });

      const pm = new ProcessManager({}, workingDirResolver);
      await expect(pm.ensure()).rejects.toThrow(ProcessStartError);
      await expect(pm.ensure()).rejects.toThrow(/Failed to spawn/);
    });

    it('uses custom copilotPath from config', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const pm = new ProcessManager(
        { copilotPath: '/usr/local/bin/copilot' },
        workingDirResolver,
      );
      await pm.ensure();

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/copilot',
        ['--acp', '--allow-all'],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });
  });
});
