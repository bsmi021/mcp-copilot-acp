/**
 * Unit tests for ResponseAggregator.
 * Validates streaming notification collection, timeout behavior, and cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResponseAggregator } from './response-aggregator.js';
import { PromptTimeoutError } from './types/index.js';

/** Type alias for the captured notification handler */
type NotificationHandler = (params: unknown) => void;

/**
 * Creates a mock subscribe function that captures the handler
 * and returns a controllable unsubscribe function.
 */
function createMockSubscribe() {
  let capturedHandler: NotificationHandler | null = null;
  const unsubscribe = vi.fn(() => {
    capturedHandler = null;
  });

  const subscribe = (handler: NotificationHandler) => {
    capturedHandler = handler;
    return unsubscribe;
  };

  /** Send a notification to the captured handler */
  const emit = (params: unknown) => {
    capturedHandler?.(params);
  };

  return { subscribe, unsubscribe, emit };
}

/**
 * Helper to build session update notification params.
 * Wraps an update object with the required sessionId field.
 */
function makeNotificationParams(
  update: Record<string, unknown>,
  sessionId = 'test-session',
) {
  return { sessionId, update };
}

describe('ResponseAggregator', () => {
  let mock: ReturnType<typeof createMockSubscribe>;

  beforeEach(() => {
    mock = createMockSubscribe();
  });

  describe('full response assembly', () => {
    it('collects message chunks and produces complete text on signal', async () => {
      const aggregator = new ResponseAggregator(mock.subscribe);
      const resultPromise = aggregator.collect();

      // Send two message chunks
      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello, ' },
        }),
      );
      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'world!' },
        }),
      );

      // Signal completion
      aggregator.signal('end_turn');

      const result = await resultPromise;
      expect(result.text).toBe('Hello, world!');
      expect(result.stopReason).toBe('end_turn');
    });
  });

  describe('tool call tracking', () => {
    it('tracks tool_call followed by tool_call_update', async () => {
      const aggregator = new ResponseAggregator(mock.subscribe);
      const resultPromise = aggregator.collect();

      // Initial tool call
      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-1',
          title: 'Read file',
          kind: 'fs_read',
          status: 'running',
        }),
      );

      // Tool call update with content
      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-1',
          status: 'completed',
          content: [{ type: 'text', text: 'file contents here' }],
        }),
      );

      aggregator.signal('end_turn');
      const result = await resultPromise;

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolCallId).toBe('tc-1');
      expect(result.toolCalls[0].title).toBe('Read file');
      expect(result.toolCalls[0].kind).toBe('fs_read');
      expect(result.toolCalls[0].status).toBe('completed');
      expect(result.toolCalls[0].content).toEqual(['file contents here']);
    });
  });

  describe('plan updates', () => {
    it('replaces previous plan with new plan entries', async () => {
      const aggregator = new ResponseAggregator(mock.subscribe);
      const resultPromise = aggregator.collect();

      // First plan
      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'plan',
          entries: [{ id: 'step-1', title: 'Step 1', status: 'pending' }],
        }),
      );

      // Replacement plan
      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'plan',
          entries: [
            { id: 'step-1', title: 'Step 1', status: 'done' },
            { id: 'step-2', title: 'Step 2', status: 'pending' },
          ],
        }),
      );

      aggregator.signal('end_turn');
      const result = await resultPromise;

      expect(result.plan).toHaveLength(2);
      expect(result.plan[0]).toEqual({ id: 'step-1', title: 'Step 1', status: 'done' });
      expect(result.plan[1]).toEqual({ id: 'step-2', title: 'Step 2', status: 'pending' });
    });
  });

  describe('thought chunk accumulation', () => {
    it('accumulates thought chunks into thoughts string', async () => {
      const aggregator = new ResponseAggregator(mock.subscribe);
      const resultPromise = aggregator.collect();

      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Thinking about ' },
        }),
      );
      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'the problem...' },
        }),
      );

      aggregator.signal('end_turn');
      const result = await resultPromise;

      expect(result.thoughts).toBe('Thinking about the problem...');
    });
  });

  describe('timeout behavior', () => {
    it('rejects with PromptTimeoutError when timeout expires', async () => {
      // Use fake timers for deterministic timeout testing
      vi.useFakeTimers();

      const aggregator = new ResponseAggregator(mock.subscribe, 1000);
      const resultPromise = aggregator.collect();

      // Advance time past the timeout
      vi.advanceTimersByTime(1001);

      await expect(resultPromise).rejects.toThrow(PromptTimeoutError);
      await expect(resultPromise).rejects.toThrow('Prompt timed out after 1000ms');

      vi.useRealTimers();
    });
  });

  describe('empty state', () => {
    it('returns empty PromptResult when signaled immediately', async () => {
      const aggregator = new ResponseAggregator(mock.subscribe);
      const resultPromise = aggregator.collect();

      aggregator.signal('end_turn');

      const result = await resultPromise;
      expect(result.text).toBe('');
      expect(result.thoughts).toBe('');
      expect(result.toolCalls).toEqual([]);
      expect(result.plan).toEqual([]);
      expect(result.stopReason).toBe('end_turn');
    });
  });

  describe('multiple message chunks', () => {
    it('concatenates multiple message chunks correctly', async () => {
      const aggregator = new ResponseAggregator(mock.subscribe);
      const resultPromise = aggregator.collect();

      const chunks = ['Part 1. ', 'Part 2. ', 'Part 3.'];
      for (const chunk of chunks) {
        mock.emit(
          makeNotificationParams({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: chunk },
          }),
        );
      }

      aggregator.signal('end_turn');
      const result = await resultPromise;

      expect(result.text).toBe('Part 1. Part 2. Part 3.');
    });
  });

  describe('tool call content appending', () => {
    it('appends content from multiple tool_call_update notifications', async () => {
      const aggregator = new ResponseAggregator(mock.subscribe);
      const resultPromise = aggregator.collect();

      // Initial tool call
      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-2',
          title: 'Run command',
          kind: 'terminal',
          status: 'running',
        }),
      );

      // First content update
      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-2',
          content: [{ type: 'text', text: 'line 1\n' }],
        }),
      );

      // Second content update
      mock.emit(
        makeNotificationParams({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-2',
          status: 'completed',
          content: [{ type: 'text', text: 'line 2\n' }],
        }),
      );

      aggregator.signal('end_turn');
      const result = await resultPromise;

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].content).toEqual(['line 1\n', 'line 2\n']);
      expect(result.toolCalls[0].status).toBe('completed');
    });
  });

  describe('cleanup', () => {
    it('calls unsubscribe on resolve (signal)', async () => {
      const aggregator = new ResponseAggregator(mock.subscribe);
      const resultPromise = aggregator.collect();

      expect(mock.unsubscribe).not.toHaveBeenCalled();

      aggregator.signal('end_turn');
      await resultPromise;

      expect(mock.unsubscribe).toHaveBeenCalledOnce();
    });

    it('calls unsubscribe on reject (timeout)', async () => {
      vi.useFakeTimers();

      const aggregator = new ResponseAggregator(mock.subscribe, 500);
      const resultPromise = aggregator.collect();

      expect(mock.unsubscribe).not.toHaveBeenCalled();

      vi.advanceTimersByTime(501);

      await expect(resultPromise).rejects.toThrow(PromptTimeoutError);
      expect(mock.unsubscribe).toHaveBeenCalledOnce();

      vi.useRealTimers();
    });
  });
});
