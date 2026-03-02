/**
 * Response aggregator for streaming ACP session updates.
 * Collects agent message chunks, thought chunks, tool calls,
 * and plan updates into a complete PromptResult.
 *
 * Uses dependency injection via a subscribe callback -- does NOT
 * import or depend on AcpClient directly.
 */

import {
  SessionUpdateParamsSchema,
  type SessionUpdate,
} from './types/index.js';
import type {
  PromptResult,
  ToolCallRecord,
  UnsubscribeFn,
} from './types/index.js';
import { PromptTimeoutError } from './types/index.js';

/** Default timeout for prompt collection (5 minutes) */
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Collects streaming session/update notifications into a PromptResult.
 * Created per-prompt. Call collect() to start listening, then signal()
 * when the session/prompt response arrives to resolve the result.
 */
export class ResponseAggregator {
  /** Accumulated agent message text */
  private _text = '';

  /** Accumulated thought chunks */
  private _thoughts = '';

  /** Tool calls tracked by toolCallId */
  private readonly _toolCalls = new Map<string, ToolCallRecord>();

  /** Current plan entries */
  private _plan: Array<{ id?: string; title: string; status?: string }> = [];

  /** Promise resolvers for the collect() promise */
  private _resolve: ((result: PromptResult) => void) | null = null;
  private _reject: ((error: Error) => void) | null = null;

  /** Unsubscribe function from session updates */
  private _unsubscribe: UnsubscribeFn | null = null;

  /** Timeout timer handle */
  private _timer: ReturnType<typeof setTimeout> | null = null;

  /** Subscribe callback injected at construction */
  private readonly _subscribe: (handler: (params: unknown) => void) => UnsubscribeFn;

  /** Timeout duration in milliseconds */
  private readonly _timeoutMs: number;

  /**
   * @param subscribe - Function that subscribes to session update notifications.
   *   Receives a handler and returns an unsubscribe function.
   * @param timeoutMs - Timeout for the prompt in milliseconds (default 300000)
   */
  constructor(
    subscribe: (handler: (params: unknown) => void) => UnsubscribeFn,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this._subscribe = subscribe;
    this._timeoutMs = timeoutMs;
  }

  /**
   * Start collecting session update notifications.
   * Returns a promise that resolves when signal() is called
   * or rejects on timeout.
   *
   * @returns Promise that resolves with the assembled PromptResult
   * @throws PromptTimeoutError if the timeout expires before signal() is called
   */
  collect(): Promise<PromptResult> {
    return new Promise<PromptResult>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;

      // Subscribe to session update notifications
      this._unsubscribe = this._subscribe((params: unknown) => {
        this.handleNotification(params);
      });

      // Start timeout timer
      this._timer = setTimeout(() => {
        this.cleanup();
        reject(new PromptTimeoutError(this._timeoutMs));
      }, this._timeoutMs);
    });
  }

  /**
   * Signal that the session/prompt response has arrived.
   * Resolves the collect() promise with the assembled PromptResult.
   *
   * @param stopReason - The stop reason from the session/prompt response
   */
  signal(stopReason: string): void {
    const result = this.buildResult(stopReason);
    this.cleanup();
    this._resolve?.(result);
  }

  /**
   * Parse and process a single session update notification.
   *
   * @param params - Raw notification params from the session/update notification
   */
  private handleNotification(params: unknown): void {
    const parsed = SessionUpdateParamsSchema.safeParse(params);
    if (!parsed.success) {
      // Ignore malformed notifications
      return;
    }

    this.processUpdate(parsed.data.update);
  }

  /**
   * Route a parsed session update to the appropriate handler.
   *
   * @param update - The parsed SessionUpdate object
   */
  private processUpdate(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this._text += update.content.text;
        break;
      case 'agent_thought_chunk':
        this._thoughts += update.content.text;
        break;
      case 'plan':
        this._plan = update.entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          status: entry.status,
        }));
        break;
      case 'tool_call':
        this.handleToolCall(update);
        break;
      case 'tool_call_update':
        this.handleToolCallUpdate(update);
        break;
    }
  }

  /**
   * Handle a tool_call update by creating or updating a ToolCallRecord.
   */
  private handleToolCall(update: {
    toolCallId: string;
    title?: string;
    kind?: string;
    status?: string;
  }): void {
    const existing = this._toolCalls.get(update.toolCallId);
    if (existing) {
      existing.title = update.title;
      existing.kind = update.kind;
      existing.status = update.status;
    } else {
      this._toolCalls.set(update.toolCallId, {
        toolCallId: update.toolCallId,
        title: update.title,
        kind: update.kind,
        status: update.status,
        content: [],
      });
    }
  }

  /**
   * Handle a tool_call_update by updating status and appending content text.
   */
  private handleToolCallUpdate(update: {
    toolCallId: string;
    status?: string;
    content?: Array<{ type: string; text?: string }>;
  }): void {
    let record = this._toolCalls.get(update.toolCallId);
    if (!record) {
      // Create a new record if we missed the initial tool_call
      record = {
        toolCallId: update.toolCallId,
        status: update.status,
        content: [],
      };
      this._toolCalls.set(update.toolCallId, record);
    } else {
      if (update.status !== undefined) {
        record.status = update.status;
      }
    }

    // Append text content blocks
    if (update.content) {
      for (const block of update.content) {
        if (block.type === 'text' && block.text) {
          record.content.push(block.text);
        }
      }
    }
  }

  /**
   * Build the final PromptResult from accumulated state.
   *
   * @param stopReason - The stop reason from the session/prompt response
   * @returns The assembled PromptResult
   */
  private buildResult(stopReason: string): PromptResult {
    return {
      text: this._text,
      stopReason,
      toolCalls: Array.from(this._toolCalls.values()),
      thoughts: this._thoughts,
      plan: [...this._plan],
    };
  }

  /**
   * Clean up subscriptions and timers.
   * Called on resolve (signal) or reject (timeout).
   */
  private cleanup(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
