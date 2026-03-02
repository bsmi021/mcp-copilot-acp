/**
 * copilot_session_create, copilot_session_prompt, copilot_session_destroy tools.
 * Persistent session management for multi-turn Copilot conversations.
 */

import type {
  ToolDeps,
  CopilotSessionCreateInput,
  CopilotSessionPromptInput,
  CopilotSessionDestroyInput,
  PromptResult,
  IAcpClient,
} from '../types/index.js';
import {
  CopilotSessionCreateInputSchema,
  CopilotSessionPromptInputSchema,
  CopilotSessionDestroyInputSchema,
  AcpMethods,
  type SessionNewResult,
  type SessionPromptResult,
  type ContentBlock,
} from '../types/index.js';
import { ResponseAggregator } from '../response-aggregator.js';

export {
  CopilotSessionCreateInputSchema as copilotSessionCreateSchema,
  CopilotSessionPromptInputSchema as copilotSessionPromptSchema,
  CopilotSessionDestroyInputSchema as copilotSessionDestroySchema,
};

/** Result shape for session creation */
export interface SessionCreateResult {
  sessionHandle: string;
}

/** Result shape for session destruction */
export interface SessionDestroyResult {
  destroyed: boolean;
}

/**
 * Handler for copilot_session_create.
 * Creates a persistent Copilot session for multi-turn conversations.
 */
export async function copilotSessionCreateHandler(
  input: CopilotSessionCreateInput,
  deps: ToolDeps,
): Promise<SessionCreateResult> {
  const client = await deps.processManager.ensure();
  const workingDirectory = input.workingDirectory ?? process.cwd();

  // Create ACP session
  const { sessionId } = await client.sendRequest<SessionNewResult>(
    AcpMethods.SESSION_NEW,
    { cwd: workingDirectory, mcpServers: [] },
  );

  // Register in session manager
  const handle = deps.sessionManager.create(sessionId, workingDirectory, input.name);

  return { sessionHandle: handle };
}

/**
 * Handler for copilot_session_prompt.
 * Sends a prompt to an existing persistent Copilot session.
 */
export async function copilotSessionPromptHandler(
  input: CopilotSessionPromptInput,
  deps: ToolDeps,
): Promise<PromptResult> {
  // Look up the session
  const session = deps.sessionManager.lookup(input.sessionHandle);
  const client = await deps.processManager.ensure();

  // Build content blocks
  const blocks: ContentBlock[] = [{ type: 'text', text: input.prompt }];
  if (input.context) {
    blocks.push({ type: 'text', text: input.context });
  }

  // Set up the response aggregator
  const aggregator = new ResponseAggregator(
    (handler) => client.onSessionUpdate(session.sessionId, handler),
  );
  const collectPromise = aggregator.collect();

  // Send the prompt
  const promptResult = await client.sendRequest<SessionPromptResult>(
    AcpMethods.SESSION_PROMPT,
    { sessionId: session.sessionId, prompt: blocks },
  );

  // Signal completion and collect
  aggregator.signal(promptResult.stopReason);
  return collectPromise;
}

/**
 * Handler for copilot_session_destroy.
 * Destroys a persistent Copilot session and cleans up resources.
 */
export async function copilotSessionDestroyHandler(
  input: CopilotSessionDestroyInput,
  deps: ToolDeps,
): Promise<SessionDestroyResult> {
  // Look up and remove from session manager
  const session = deps.sessionManager.destroy(input.sessionHandle);

  // Destroy the ACP session (best-effort)
  try {
    const client = await deps.processManager.ensure();
    await client.sendRequest(AcpMethods.SESSION_DESTROY, {
      sessionId: session.sessionId,
    });
  } catch {
    // Best-effort — session may already be gone if process crashed
  }

  return { destroyed: true };
}
