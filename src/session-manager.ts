/**
 * Session manager implementation.
 * Maintains an in-memory mapping from user-facing session handles (UUIDs)
 * to ACP session IDs and associated metadata.
 */

import { randomUUID } from 'node:crypto';
import type { ISessionManager, SessionInfo } from './types/index.js';
import { SessionNotFoundError } from './types/index.js';

/**
 * In-memory session manager that tracks active Copilot sessions.
 * Maps user-facing UUID handles to SessionInfo records containing
 * the ACP sessionId, working directory, and creation metadata.
 */
export class SessionManager implements ISessionManager {
  /** Internal store: handle -> SessionInfo */
  private readonly sessions = new Map<string, SessionInfo>();

  /**
   * Register a new session with a generated UUID handle.
   *
   * @param sessionId - ACP protocol session ID returned by Copilot
   * @param workingDirectory - Working directory for this session
   * @param name - Optional human-readable name for the session
   * @returns The generated UUID handle for the session
   */
  create(sessionId: string, workingDirectory: string, name?: string): string {
    const handle = randomUUID();
    const info: SessionInfo = {
      handle,
      sessionId,
      workingDirectory,
      name,
      createdAt: new Date(),
    };
    this.sessions.set(handle, info);
    return handle;
  }

  /**
   * Look up a session by its user-facing handle.
   *
   * @param handle - The UUID handle returned by create()
   * @returns The SessionInfo for the given handle
   * @throws SessionNotFoundError if the handle is not found
   */
  lookup(handle: string): SessionInfo {
    const info = this.sessions.get(handle);
    if (!info) {
      throw new SessionNotFoundError(handle);
    }
    return info;
  }

  /**
   * Look up a session by its ACP protocol session ID.
   * Iterates all sessions since sessionId is not the primary key.
   *
   * @param sessionId - The ACP session ID to search for
   * @returns The SessionInfo if found, undefined otherwise
   */
  lookupBySessionId(sessionId: string): SessionInfo | undefined {
    for (const info of this.sessions.values()) {
      if (info.sessionId === sessionId) {
        return info;
      }
    }
    return undefined;
  }

  /**
   * Destroy a session by its user-facing handle.
   *
   * @param handle - The UUID handle of the session to destroy
   * @returns The removed SessionInfo
   * @throws SessionNotFoundError if the handle is not found
   */
  destroy(handle: string): SessionInfo {
    const info = this.sessions.get(handle);
    if (!info) {
      throw new SessionNotFoundError(handle);
    }
    this.sessions.delete(handle);
    return info;
  }

  /**
   * List all active sessions.
   *
   * @returns Array of all SessionInfo values
   */
  listAll(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clear all sessions. Used during shutdown.
   */
  clear(): void {
    this.sessions.clear();
  }
}
