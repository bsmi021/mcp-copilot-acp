/**
 * Unit tests for AcpClient.
 * Uses mock PassThrough streams — no live Copilot process needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import * as path from 'node:path';
import { AcpClient } from './acp-client.js';

// ============================================================
// Test Helpers
// ============================================================

/** Create an AcpClient wired to mock PassThrough streams. */
function createTestClient(workingDir = '/test/project') {
  /** Stream simulating Copilot stdout (client reads from this) */
  const copilotOutput = new PassThrough();
  /** Stream simulating Copilot stdin (client writes to this) */
  const copilotInput = new PassThrough({ encoding: 'utf-8' });

  const resolver = (_sessionId: string) => workingDir;
  const client = new AcpClient(copilotOutput, copilotInput, resolver);

  return { client, copilotOutput, copilotInput };
}

/** Read the next NDJSON line written by the client. */
function readNextLine(stream: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx >= 0) {
        stream.removeListener('data', onData);
        const line = buffer.slice(0, newlineIdx);
        resolve(JSON.parse(line) as Record<string, unknown>);
      }
    };
    stream.on('data', onData);
  });
}

/** Send a JSON-RPC message to the client via the mock Copilot output. */
function sendToCopilotOutput(stream: PassThrough, message: Record<string, unknown>): void {
  stream.write(JSON.stringify(message) + '\n');
}

// ============================================================
// Tests
// ============================================================

describe('AcpClient', () => {
  let client: AcpClient;
  let copilotOutput: PassThrough;
  let copilotInput: PassThrough;

  beforeEach(() => {
    const setup = createTestClient();
    client = setup.client;
    copilotOutput = setup.copilotOutput;
    copilotInput = setup.copilotInput;
  });

  // ----------------------------------------------------------
  // JSON-RPC Serialization
  // ----------------------------------------------------------

  describe('sendRequest', () => {
    it('writes correct NDJSON with incrementing ids', async () => {
      const linePromise1 = readNextLine(copilotInput);
      const _promise1 = client.sendRequest('test/method1', { key: 'val1' });
      const line1 = await linePromise1;

      expect(line1).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'test/method1',
        params: { key: 'val1' },
      });

      const linePromise2 = readNextLine(copilotInput);
      const _promise2 = client.sendRequest('test/method2');
      const line2 = await linePromise2;

      expect(line2).toEqual({
        jsonrpc: '2.0',
        id: 2,
        method: 'test/method2',
        params: undefined,
      });
    });
  });

  // ----------------------------------------------------------
  // Response Routing
  // ----------------------------------------------------------

  describe('response routing', () => {
    it('resolves pending request on matching response', async () => {
      const promise = client.sendRequest<{ answer: number }>('test/echo');

      sendToCopilotOutput(copilotOutput, {
        jsonrpc: '2.0',
        id: 1,
        result: { answer: 42 },
      });

      const result = await promise;
      expect(result).toEqual({ answer: 42 });
    });

    it('rejects pending request on error response', async () => {
      const promise = client.sendRequest('test/fail');

      sendToCopilotOutput(copilotOutput, {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Bad request' },
      });

      await expect(promise).rejects.toThrow('JSON-RPC error -32600: Bad request');
    });

    it('handles out-of-order responses correctly', async () => {
      const promise1 = client.sendRequest<string>('method/a');
      const promise2 = client.sendRequest<string>('method/b');

      // Respond to request 2 first, then request 1
      sendToCopilotOutput(copilotOutput, {
        jsonrpc: '2.0',
        id: 2,
        result: 'response-b',
      });
      sendToCopilotOutput(copilotOutput, {
        jsonrpc: '2.0',
        id: 1,
        result: 'response-a',
      });

      const [r1, r2] = await Promise.all([promise1, promise2]);
      expect(r1).toBe('response-a');
      expect(r2).toBe('response-b');
    });
  });

  // ----------------------------------------------------------
  // Incoming Request Dispatching
  // ----------------------------------------------------------

  describe('incoming request handling', () => {
    it('dispatches permission request and auto-approves', async () => {
      const linePromise = readNextLine(copilotInput);

      sendToCopilotOutput(copilotOutput, {
        jsonrpc: '2.0',
        id: 100,
        method: 'session/request_permission',
        params: {
          sessionId: 'sess-1',
          toolCall: { toolCallId: 'tc-1', title: 'Run command' },
          options: [{ optionId: 'allow-once', title: 'Allow once' }],
        },
      });

      const response = await linePromise;
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 100,
        result: {
          outcome: { outcome: 'selected', optionId: 'allow-once' },
        },
      });
    });

    it('returns error for unknown methods', async () => {
      const linePromise = readNextLine(copilotInput);

      sendToCopilotOutput(copilotOutput, {
        jsonrpc: '2.0',
        id: 200,
        method: 'unknown/method',
        params: {},
      });

      const response = await linePromise;
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 200,
        error: { code: -32601, message: 'Method not found: unknown/method' },
      });
    });
  });

  // ----------------------------------------------------------
  // Permission Auto-Approval Shape
  // ----------------------------------------------------------

  describe('permission auto-approval', () => {
    it('response shape matches RequestPermissionResult schema', async () => {
      const linePromise = readNextLine(copilotInput);

      sendToCopilotOutput(copilotOutput, {
        jsonrpc: '2.0',
        id: 300,
        method: 'session/request_permission',
        params: {
          sessionId: 'sess-x',
          toolCall: { toolCallId: 'tc-x' },
          options: [
            { optionId: 'allow-once', title: 'Allow' },
            { optionId: 'deny', title: 'Deny' },
          ],
        },
      });

      const response = await linePromise;
      const result = (response as { result: unknown }).result as Record<string, unknown>;
      expect(result).toHaveProperty('outcome');

      const outcome = result['outcome'] as Record<string, unknown>;
      expect(outcome['outcome']).toBe('selected');
      expect(outcome['optionId']).toBe('allow-once');
    });
  });

  // ----------------------------------------------------------
  // Session Update Notifications
  // ----------------------------------------------------------

  describe('notification routing', () => {
    it('emits session update to registered handlers', async () => {
      const handler = vi.fn();
      client.onSessionUpdate('sess-1', handler);

      sendToCopilotOutput(copilotOutput, {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello' },
          },
        },
      });

      // Allow microtask queue to flush
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello' },
        },
      });
    });

    it('does not emit to handlers of other sessions', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      client.onSessionUpdate('sess-1', handler1);
      client.onSessionUpdate('sess-2', handler2);

      sendToCopilotOutput(copilotOutput, {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Only for 1' },
          },
        },
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('unsubscribe removes handler', async () => {
      const handler = vi.fn();
      const unsub = client.onSessionUpdate('sess-1', handler);
      unsub();

      sendToCopilotOutput(copilotOutput, {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'After unsub' },
          },
        },
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // Stream Close / Pending Rejection
  // ----------------------------------------------------------

  describe('stream close', () => {
    it('rejects all pending requests when stream closes', async () => {
      const promise1 = client.sendRequest('test/one');
      const promise2 = client.sendRequest('test/two');

      copilotOutput.end();

      await expect(promise1).rejects.toThrow('ACP transport stream closed');
      await expect(promise2).rejects.toThrow('ACP transport stream closed');
    });
  });

  // ----------------------------------------------------------
  // destroy()
  // ----------------------------------------------------------

  describe('destroy', () => {
    it('rejects all pending requests', async () => {
      const promise1 = client.sendRequest('test/a');
      const promise2 = client.sendRequest('test/b');

      client.destroy();

      await expect(promise1).rejects.toThrow('AcpClient destroyed');
      await expect(promise2).rejects.toThrow('AcpClient destroyed');
    });

    it('rejects new requests after destruction', async () => {
      client.destroy();
      await expect(client.sendRequest('test/after')).rejects.toThrow(
        'AcpClient has been destroyed',
      );
    });
  });

  // ----------------------------------------------------------
  // sendResponse
  // ----------------------------------------------------------

  describe('sendResponse', () => {
    it('writes correct JSON-RPC response format', async () => {
      const linePromise = readNextLine(copilotInput);
      client.sendResponse(42, { status: 'ok' });
      const line = await linePromise;

      expect(line).toEqual({
        jsonrpc: '2.0',
        id: 42,
        result: { status: 'ok' },
      });
    });
  });

  // ----------------------------------------------------------
  // Path Traversal Guard
  // ----------------------------------------------------------

  describe('path traversal guard', () => {
    it('rejects path traversal attempts', async () => {
      // Use a platform-aware working dir
      const workDir = path.resolve('/test/project');
      const setup = createTestClient(workDir);
      const testClient = setup.client;

      const linePromise = readNextLine(setup.copilotInput);

      sendToCopilotOutput(setup.copilotOutput, {
        jsonrpc: '2.0',
        id: 500,
        method: 'fs/read_text_file',
        params: {
          sessionId: 'sess-1',
          path: '../../../etc/passwd',
        },
      });

      const response = await linePromise;
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 500,
        error: {
          code: -32602,
          message: expect.stringContaining('Path traversal denied'),
        },
      });

      testClient.destroy();
    });

    it('allows valid relative paths within working directory', async () => {
      // This test checks the path resolution logic by sending a
      // fs/read_text_file request with a valid subpath. It will fail
      // to read the file (doesn't exist), but should NOT be rejected
      // as a path traversal — it should get a -32603 (internal error)
      // instead of -32602 (invalid params / traversal).
      const workDir = path.resolve('/test/project');
      const setup = createTestClient(workDir);
      const testClient = setup.client;

      const linePromise = readNextLine(setup.copilotInput);

      sendToCopilotOutput(setup.copilotOutput, {
        jsonrpc: '2.0',
        id: 501,
        method: 'fs/read_text_file',
        params: {
          sessionId: 'sess-1',
          path: 'src/index.ts',
        },
      });

      const response = await linePromise;
      // Should be an internal error (file not found), NOT a traversal error
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 501,
        error: {
          code: -32603,
        },
      });
      // Verify it's not a traversal error
      const errMsg = ((response as Record<string, unknown>).error as Record<string, unknown>)['message'] as string;
      expect(errMsg).not.toContain('Path traversal');

      testClient.destroy();
    });
  });

  // ----------------------------------------------------------
  // NDJSON Chunked Delivery
  // ----------------------------------------------------------

  describe('NDJSON chunked delivery', () => {
    it('handles partial chunks split across data events', async () => {
      const promise = client.sendRequest<{ ok: boolean }>('test/chunked');

      // Send response in partial chunks
      const fullResponse = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { ok: true },
      }) + '\n';

      const midpoint = Math.floor(fullResponse.length / 2);
      const chunk1 = fullResponse.slice(0, midpoint);
      const chunk2 = fullResponse.slice(midpoint);

      copilotOutput.write(chunk1);
      // Simulate network delay
      await new Promise((r) => setTimeout(r, 5));
      copilotOutput.write(chunk2);

      const result = await promise;
      expect(result).toEqual({ ok: true });
    });

    it('handles multiple messages in one chunk', async () => {
      const promise1 = client.sendRequest<string>('test/multi1');
      const promise2 = client.sendRequest<string>('test/multi2');

      // Send both responses in a single write
      const combined =
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'first' }) +
        '\n' +
        JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'second' }) +
        '\n';

      copilotOutput.write(combined);

      const [r1, r2] = await Promise.all([promise1, promise2]);
      expect(r1).toBe('first');
      expect(r2).toBe('second');
    });

    it('handles \\r\\n line endings', async () => {
      const promise = client.sendRequest<string>('test/crlf');

      copilotOutput.write(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'crlf-ok' }) + '\r\n',
      );

      const result = await promise;
      expect(result).toBe('crlf-ok');
    });
  });
});
