/**
 * MCP tool input/output types and interface contracts.
 * Defines the shapes for all MCP tool parameters, results,
 * and the dependency injection interfaces used across the server.
 */

import { z } from 'zod';
import type { AgentCapabilities } from './acp.js';

// ============================================================
// Interface Contracts (Dependency Injection)
// ============================================================

/** Unsubscribe function returned by event subscriptions */
export type UnsubscribeFn = () => void;

/** Handler for session update notifications */
export type SessionUpdateHandler = (params: unknown) => void;

/**
 * ACP client interface for communicating with Copilot.
 * Implementations: AcpClient (stdio), AcpTcpClient (TCP)
 */
export interface IAcpClient {
  /** Send a JSON-RPC request and await the response */
  sendRequest<T>(method: string, params?: unknown): Promise<T>;

  /** Subscribe to session/update notifications for a given sessionId */
  onSessionUpdate(sessionId: string, handler: SessionUpdateHandler): UnsubscribeFn;

  /** Send a JSON-RPC response (for incoming requests from Copilot) */
  sendResponse(id: number | string, result: unknown): void;

  /** Copilot's capabilities from initialization (null if not yet initialized) */
  capabilities: AgentCapabilities | null;
}

/**
 * Process manager interface for the Copilot child process lifecycle.
 */
export interface IProcessManager {
  /** Ensure Copilot is running, lazy-starting if needed. Returns the ACP client. */
  ensure(): Promise<IAcpClient>;

  /** Check if the Copilot process is currently alive */
  isAlive(): boolean;

  /** Gracefully shut down the Copilot process */
  shutdown(): Promise<void>;
}

/**
 * Session info tracked by the session manager.
 */
export interface SessionInfo {
  /** User-facing session handle (UUID) */
  handle: string;

  /** ACP protocol session ID (from Copilot) */
  sessionId: string;

  /** Working directory for this session */
  workingDirectory: string;

  /** Optional user-provided session name */
  name?: string;

  /** Session creation timestamp */
  createdAt: Date;
}

/**
 * Session manager interface for tracking active sessions.
 */
export interface ISessionManager {
  /** Register a new session. Returns the user-facing handle. */
  create(sessionId: string, workingDirectory: string, name?: string): string;

  /** Look up session by handle. Throws SessionNotFoundError if not found. */
  lookup(handle: string): SessionInfo;

  /** Look up session by ACP sessionId. Returns undefined if not found. */
  lookupBySessionId(sessionId: string): SessionInfo | undefined;

  /** Destroy a session by handle. Throws SessionNotFoundError if not found. */
  destroy(handle: string): SessionInfo;

  /** List all active sessions */
  listAll(): SessionInfo[];

  /** Clear all sessions (for shutdown) */
  clear(): void;
}

// ============================================================
// Tool Dependencies (Injected into tool handlers)
// ============================================================

export interface ToolDeps {
  processManager: IProcessManager;
  sessionManager: ISessionManager;
}

// ============================================================
// MCP Tool Input Schemas (Zod raw shapes for server.tool())
// ============================================================

export const CopilotPromptInputSchema = z.object({
  prompt: z.string().describe('The prompt text to send to Copilot'),
  workingDirectory: z
    .string()
    .optional()
    .describe('Working directory for Copilot (defaults to project root)'),
  context: z
    .string()
    .optional()
    .describe('Additional context or file contents to include with the prompt'),
});
export type CopilotPromptInput = z.infer<typeof CopilotPromptInputSchema>;

export const CopilotSessionCreateInputSchema = z.object({
  workingDirectory: z
    .string()
    .optional()
    .describe('Working directory for Copilot (defaults to project root)'),
  name: z
    .string()
    .optional()
    .describe('Optional human-readable name for the session'),
});
export type CopilotSessionCreateInput = z.infer<typeof CopilotSessionCreateInputSchema>;

export const CopilotSessionPromptInputSchema = z.object({
  sessionHandle: z.string().describe('Session handle returned by copilot_session_create'),
  prompt: z.string().describe('The prompt text to send to the existing session'),
  context: z
    .string()
    .optional()
    .describe('Additional context or file contents to include with the prompt'),
});
export type CopilotSessionPromptInput = z.infer<typeof CopilotSessionPromptInputSchema>;

export const CopilotSessionDestroyInputSchema = z.object({
  sessionHandle: z.string().describe('Session handle to destroy'),
});
export type CopilotSessionDestroyInput = z.infer<typeof CopilotSessionDestroyInputSchema>;

export const CopilotCompareInputSchema = z.object({
  prompt: z.string().describe('The prompt to run through Copilot for comparison'),
  workingDirectory: z
    .string()
    .optional()
    .describe('Working directory for Copilot (defaults to project root)'),
});
export type CopilotCompareInput = z.infer<typeof CopilotCompareInputSchema>;

// ============================================================
// MCP Tool Output Types
// ============================================================

/** Record of a tool call made by Copilot during a prompt */
export interface ToolCallRecord {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  content: string[];
}

/** Result from a Copilot prompt (one-shot or session) */
export interface PromptResult {
  /** Concatenated agent message text */
  text: string;

  /** Stop reason from Copilot */
  stopReason: string;

  /** Tool calls Copilot made during the prompt */
  toolCalls: ToolCallRecord[];

  /** Thought chunks (if any) */
  thoughts: string;

  /** Plan entries (if any) */
  plan: Array<{ id?: string; title: string; status?: string }>;
}

/** Result from copilot_status tool */
export interface StatusResult {
  processRunning: boolean;
  sessions: Array<{
    handle: string;
    sessionId: string;
    name?: string;
    workingDirectory: string;
    createdAt: string;
  }>;
  capabilities: AgentCapabilities | null;
}

/** Result from copilot_compare tool */
export interface CompareResult {
  copilotResponse: PromptResult;
  metadata: {
    durationMs: number;
    timestamp: string;
  };
}

// ============================================================
// Custom Error Classes
// ============================================================

export class SessionNotFoundError extends Error {
  constructor(handle: string) {
    super(`Session not found: ${handle}`);
    this.name = 'SessionNotFoundError';
  }
}

export class PromptTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Prompt timed out after ${timeoutMs}ms`);
    this.name = 'PromptTimeoutError';
  }
}

export class AcpConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpConnectionError';
  }
}

export class ProcessStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessStartError';
  }
}
