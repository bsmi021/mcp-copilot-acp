/**
 * Unit tests for SessionManager.
 * Validates handle generation, session lookup, destruction, and lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from './session-manager.js';
import { SessionNotFoundError } from './types/index.js';

/** UUID v4 regex pattern for validation */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  describe('create()', () => {
    it('returns a valid UUID handle', () => {
      const handle = manager.create('acp-session-1', '/project');
      expect(handle).toMatch(UUID_REGEX);
    });

    it('stores session with correct fields', () => {
      const handle = manager.create('acp-session-1', '/project', 'my-session');
      const info = manager.lookup(handle);

      expect(info.handle).toBe(handle);
      expect(info.sessionId).toBe('acp-session-1');
      expect(info.workingDirectory).toBe('/project');
      expect(info.name).toBe('my-session');
      expect(info.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('lookup()', () => {
    it('returns correct session info for a valid handle', () => {
      const handle = manager.create('acp-session-1', '/project');
      const info = manager.lookup(handle);

      expect(info.handle).toBe(handle);
      expect(info.sessionId).toBe('acp-session-1');
    });

    it('throws SessionNotFoundError for unknown handle', () => {
      expect(() => manager.lookup('nonexistent-handle')).toThrow(SessionNotFoundError);
    });
  });

  describe('lookupBySessionId()', () => {
    it('finds session by ACP session ID', () => {
      const handle = manager.create('acp-session-42', '/project');
      const info = manager.lookupBySessionId('acp-session-42');

      expect(info).toBeDefined();
      expect(info?.handle).toBe(handle);
      expect(info?.sessionId).toBe('acp-session-42');
    });

    it('returns undefined for unknown session ID', () => {
      manager.create('acp-session-1', '/project');
      const result = manager.lookupBySessionId('nonexistent-session-id');

      expect(result).toBeUndefined();
    });
  });

  describe('destroy()', () => {
    it('removes session and returns info', () => {
      const handle = manager.create('acp-session-1', '/project', 'test-session');
      const info = manager.destroy(handle);

      expect(info.handle).toBe(handle);
      expect(info.sessionId).toBe('acp-session-1');
      expect(info.name).toBe('test-session');

      // Verify session is no longer accessible
      expect(() => manager.lookup(handle)).toThrow(SessionNotFoundError);
    });

    it('throws SessionNotFoundError for unknown handle', () => {
      expect(() => manager.destroy('nonexistent-handle')).toThrow(SessionNotFoundError);
    });
  });

  describe('listAll()', () => {
    it('returns all sessions', () => {
      manager.create('session-a', '/project-a', 'alpha');
      manager.create('session-b', '/project-b', 'beta');
      manager.create('session-c', '/project-c');

      const sessions = manager.listAll();

      expect(sessions).toHaveLength(3);
      const sessionIds = sessions.map((s) => s.sessionId);
      expect(sessionIds).toContain('session-a');
      expect(sessionIds).toContain('session-b');
      expect(sessionIds).toContain('session-c');
    });

    it('returns empty array when no sessions', () => {
      const sessions = manager.listAll();
      expect(sessions).toEqual([]);
    });
  });

  describe('clear()', () => {
    it('removes all sessions', () => {
      manager.create('session-a', '/project-a');
      manager.create('session-b', '/project-b');

      expect(manager.listAll()).toHaveLength(2);

      manager.clear();

      expect(manager.listAll()).toEqual([]);
    });
  });

  describe('multiple sessions', () => {
    it('can coexist and be independently accessed', () => {
      const handle1 = manager.create('session-1', '/project-1', 'first');
      const handle2 = manager.create('session-2', '/project-2', 'second');
      const handle3 = manager.create('session-3', '/project-3', 'third');

      // Each handle maps to the correct session
      expect(manager.lookup(handle1).sessionId).toBe('session-1');
      expect(manager.lookup(handle2).sessionId).toBe('session-2');
      expect(manager.lookup(handle3).sessionId).toBe('session-3');

      // Destroying one does not affect others
      manager.destroy(handle2);

      expect(manager.lookup(handle1).sessionId).toBe('session-1');
      expect(() => manager.lookup(handle2)).toThrow(SessionNotFoundError);
      expect(manager.lookup(handle3).sessionId).toBe('session-3');

      expect(manager.listAll()).toHaveLength(2);
    });
  });
});
