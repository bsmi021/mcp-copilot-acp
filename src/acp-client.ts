/**
 * ACP JSON-RPC bidirectional transport client.
 * Implements IAcpClient for NDJSON-framed communication with Copilot
 * over stdio streams (Readable input, Writable output).
 */

import { type Readable, type Writable } from 'node:stream';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  type AgentCapabilities,
  type JsonRpcMessage,
  type JsonRpcError,
  type SessionUpdateParams,
  JsonRpcMessageSchema,
  SessionUpdateParamsSchema,
  RequestPermissionParamsSchema,
  FsReadTextFileParamsSchema,
  FsWriteTextFileParamsSchema,
  ACP_PROTOCOL_VERSION,
  AcpMethods,
  InitializeResultSchema,
  type InitializeResult,
} from './types/index.js';

import type {
  IAcpClient,
  SessionUpdateHandler,
  UnsubscribeFn,
} from './types/index.js';

// ============================================================
// Pending Request Tracking
// ============================================================

/** Stored resolve/reject for an outstanding JSON-RPC request */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

// ============================================================
// AcpClient Implementation
// ============================================================

export class AcpClient implements IAcpClient {
  /** Copilot capabilities received during initialization */
  public capabilities: AgentCapabilities | null = null;

  /** Monotonically increasing request ID counter */
  private _nextId = 1;

  /** Pending JSON-RPC requests awaiting responses */
  private _pendingRequests = new Map<number | string, PendingRequest>();

  /** Session update notification handlers keyed by sessionId */
  private _sessionHandlers = new Map<string, Set<SessionUpdateHandler>>();

  /** Input stream from Copilot process stdout */
  private readonly _input: Readable;

  /** Output stream to Copilot process stdin */
  private readonly _output: Writable;

  /** Callback to resolve working directory for a given session */
  private readonly _workingDirectoryResolver: (sessionId: string) => string;

  /** Buffer for accumulating partial NDJSON lines */
  private _lineBuffer = '';

  /** Whether this client has been destroyed */
  private _destroyed = false;

  constructor(
    input: Readable,
    output: Writable,
    workingDirectoryResolver: (sessionId: string) => string,
  ) {
    this._input = input;
    this._output = output;
    this._workingDirectoryResolver = workingDirectoryResolver;

    this._input.on('data', (chunk: Buffer | string) => {
      this._onData(chunk.toString('utf-8'));
    });

    this._input.on('end', () => {
      this._onStreamClose();
    });

    this._input.on('error', () => {
      this._onStreamClose();
    });
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Send a JSON-RPC request and return a promise that resolves
   * when the matching response arrives.
   */
  sendRequest<T>(method: string, params?: unknown): Promise<T> {
    if (this._destroyed) {
      return Promise.reject(new Error('AcpClient has been destroyed'));
    }

    const id = this._nextId++;
    const message = {
      jsonrpc: '2.0' as const,
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      this._pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this._writeLine(message);
    });
  }

  /** Subscribe to session/update notifications for a given sessionId. */
  onSessionUpdate(sessionId: string, handler: SessionUpdateHandler): UnsubscribeFn {
    let handlers = this._sessionHandlers.get(sessionId);
    if (!handlers) {
      handlers = new Set();
      this._sessionHandlers.set(sessionId, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this._sessionHandlers.delete(sessionId);
      }
    };
  }

  /** Send a JSON-RPC response (for incoming requests from Copilot). */
  sendResponse(id: number | string, result: unknown): void {
    const message = {
      jsonrpc: '2.0' as const,
      id,
      result,
    };
    this._writeLine(message);
  }

  /** Send a JSON-RPC error response for an incoming request. */
  sendErrorResponse(id: number | string, error: JsonRpcError): void {
    const message = {
      jsonrpc: '2.0' as const,
      id,
      error,
    };
    this._writeLine(message);
  }

  /** Initialize the ACP connection with Copilot. */
  async initialize(): Promise<InitializeResult> {
    const result = await this.sendRequest<InitializeResult>(
      AcpMethods.INITIALIZE,
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fileSystem: { read: true, write: true },
          terminal: true,
        },
        clientInfo: {
          name: 'mcp-copilot-acp',
          version: '0.1.0',
        },
      },
    );

    const parsed = InitializeResultSchema.parse(result);
    this.capabilities = parsed.agentCapabilities ?? null;
    return parsed;
  }

  /** Clean up all listeners and reject pending requests. */
  destroy(): void {
    this._destroyed = true;
    this._rejectAllPending(new Error('AcpClient destroyed'));
    this._sessionHandlers.clear();
    this._input.removeAllListeners('data');
    this._input.removeAllListeners('end');
    this._input.removeAllListeners('error');
  }

  // ============================================================
  // NDJSON Framing
  // ============================================================

  /** Accumulate incoming data and process complete lines. */
  private _onData(chunk: string): void {
    this._lineBuffer += chunk;
    const lines = this._lineBuffer.split('\n');
    // Keep the last (possibly incomplete) segment in the buffer
    this._lineBuffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '').trim();
      if (line.length > 0) {
        this._handleLine(line);
      }
    }
  }

  /** Write a JSON object as a single NDJSON line to the output stream. */
  private _writeLine(message: Record<string, unknown>): void {
    this._output.write(JSON.stringify(message) + '\n');
  }

  // ============================================================
  // Message Routing
  // ============================================================

  /** Parse and route a single JSON-RPC message line. */
  private _handleLine(line: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      // Ignore malformed JSON lines
      return;
    }

    const parseResult = JsonRpcMessageSchema.safeParse(raw);
    if (!parseResult.success) {
      return;
    }

    const msg: JsonRpcMessage = parseResult.data;

    if (msg.id !== undefined && msg.method !== undefined) {
      // Incoming request from Copilot
      this._handleIncomingRequest(msg.id, msg.method, msg.params);
    } else if (msg.id !== undefined) {
      // Response to one of our requests
      this._handleResponse(msg);
    } else if (msg.method !== undefined) {
      // Notification (no id)
      this._handleNotification(msg.method, msg.params);
    }
  }

  /** Handle a response that matches a pending request. */
  private _handleResponse(msg: JsonRpcMessage): void {
    const pending = this._pendingRequests.get(msg.id!);
    if (!pending) {
      return;
    }
    this._pendingRequests.delete(msg.id!);

    if (msg.error) {
      pending.reject(new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  /** Handle a notification (session/update). */
  private _handleNotification(method: string, params: unknown): void {
    if (method === AcpMethods.SESSION_UPDATE) {
      const parsed = SessionUpdateParamsSchema.safeParse(params);
      if (parsed.success) {
        this._emitSessionUpdate(parsed.data);
      }
    }
  }

  /** Emit a session update to registered handlers. */
  private _emitSessionUpdate(updateParams: SessionUpdateParams): void {
    const handlers = this._sessionHandlers.get(updateParams.sessionId);
    if (handlers) {
      for (const handler of handlers) {
        handler(updateParams);
      }
    }
  }

  // ============================================================
  // Incoming Request Handlers
  // ============================================================

  /** Dispatch an incoming request from Copilot to the appropriate handler. */
  private _handleIncomingRequest(
    id: number | string,
    method: string,
    params: unknown,
  ): void {
    switch (method) {
      case AcpMethods.REQUEST_PERMISSION:
        this._handlePermissionRequest(id, params);
        break;
      case AcpMethods.FS_READ_TEXT_FILE:
        this._handleFsRead(id, params);
        break;
      case AcpMethods.FS_WRITE_TEXT_FILE:
        this._handleFsWrite(id, params);
        break;
      default:
        this.sendErrorResponse(id, {
          code: -32601,
          message: `Method not found: ${method}`,
        });
    }
  }

  /**
   * Auto-approve permission requests (YOLO mode).
   * Selects the first available option, preferring 'allow-once'.
   */
  private _handlePermissionRequest(id: number | string, params: unknown): void {
    const parsed = RequestPermissionParamsSchema.safeParse(params);
    if (!parsed.success) {
      // Approve even if params don't fully match our schema
      // (Copilot may send extra fields we don't model)
      const rawParams = params as Record<string, unknown>;
      if (rawParams?.['toolCall']) {
        this.sendResponse(id, {
          outcome: { outcome: 'selected', optionId: 'allow-once' },
        });
        return;
      }
      this.sendErrorResponse(id, {
        code: -32602,
        message: 'Invalid permission request params',
      });
      return;
    }

    const optionIds = parsed.data.options.map((o) => o.optionId);
    const optionId = optionIds.includes('allow-once')
      ? 'allow-once'
      : optionIds[0] ?? 'allow-once';

    this.sendResponse(id, {
      outcome: { outcome: 'selected', optionId },
    });
  }

  /** Read a file from disk for Copilot. */
  private async _handleFsRead(id: number | string, params: unknown): Promise<void> {
    const parsed = FsReadTextFileParamsSchema.safeParse(params);
    if (!parsed.success) {
      this.sendErrorResponse(id, {
        code: -32602,
        message: 'Invalid fs/read_text_file params',
      });
      return;
    }

    const result = this._resolveAndValidatePath(
      parsed.data.sessionId,
      parsed.data.path,
    );
    if (!result.valid) {
      this.sendErrorResponse(id, {
        code: -32602,
        message: result.error,
      });
      return;
    }

    try {
      const content = await fs.readFile(result.resolvedPath, 'utf-8');
      this.sendResponse(id, { content });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to read file';
      this.sendErrorResponse(id, { code: -32603, message });
    }
  }

  /** Write a file to disk for Copilot. */
  private async _handleFsWrite(id: number | string, params: unknown): Promise<void> {
    const parsed = FsWriteTextFileParamsSchema.safeParse(params);
    if (!parsed.success) {
      this.sendErrorResponse(id, {
        code: -32602,
        message: 'Invalid fs/write_text_file params',
      });
      return;
    }

    const result = this._resolveAndValidatePath(
      parsed.data.sessionId,
      parsed.data.path,
    );
    if (!result.valid) {
      this.sendErrorResponse(id, {
        code: -32602,
        message: result.error,
      });
      return;
    }

    try {
      await fs.writeFile(result.resolvedPath, parsed.data.content, 'utf-8');
      this.sendResponse(id, {});
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to write file';
      this.sendErrorResponse(id, { code: -32603, message });
    }
  }

  // ============================================================
  // Path Security
  // ============================================================

  /**
   * Resolve a requested path against the session working directory
   * and validate it does not traverse outside.
   */
  private _resolveAndValidatePath(
    sessionId: string,
    requestedPath: string,
  ): { valid: true; resolvedPath: string } | { valid: false; error: string } {
    const workingDir = this._workingDirectoryResolver(sessionId);
    const normalizedWorkingDir = path.resolve(workingDir);
    const resolvedPath = path.resolve(normalizedWorkingDir, requestedPath);

    if (!resolvedPath.startsWith(normalizedWorkingDir)) {
      return {
        valid: false,
        error: `Path traversal denied: ${requestedPath} resolves outside working directory`,
      };
    }

    return { valid: true, resolvedPath };
  }

  // ============================================================
  // Stream Lifecycle
  // ============================================================

  /** Handle input stream closing — reject all pending requests. */
  private _onStreamClose(): void {
    this._rejectAllPending(new Error('ACP transport stream closed'));
  }

  /** Reject all pending requests with the given error. */
  private _rejectAllPending(error: Error): void {
    for (const [, pending] of this._pendingRequests) {
      pending.reject(error);
    }
    this._pendingRequests.clear();
  }
}
