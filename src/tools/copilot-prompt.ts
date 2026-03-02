/**
 * copilot_prompt tool — One-shot prompt to GitHub Copilot.
 * Creates a session, sends the prompt, collects the response,
 * and destroys the session automatically.
 */

import type {
  ToolDeps,
  CopilotPromptInput,
  PromptResult,
  IAcpClient,
} from '../types/index.js';
import {
  CopilotPromptInputSchema,
  AcpMethods,
  type SessionNewResult,
  type SessionPromptResult,
  type ContentBlock,
} from '../types/index.js';
import { ResponseAggregator } from '../response-aggregator.js';

export { CopilotPromptInputSchema as copilotPromptSchema };

/**
 * Build the prompt content blocks from the input text and optional context.
 */
function buildPromptBlocks(prompt: string, context?: string): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: 'text', text: prompt }];
  if (context) {
    blocks.push({ type: 'text', text: context });
  }
  return blocks;
}

/**
 * Core prompt flow shared between copilot_prompt and copilot_compare.
 * Creates session, sends prompt, collects response, destroys session.
 */
export async function executeOneShot(
  client: IAcpClient,
  prompt: string,
  workingDirectory: string,
  context?: string,
  timeoutMs?: number,
): Promise<PromptResult> {
  // 1. Create a temporary session
  const { sessionId } = await client.sendRequest<SessionNewResult>(
    AcpMethods.SESSION_NEW,
    { cwd: workingDirectory, mcpServers: [] },
  );

  try {
    // 2. Set up the response aggregator
    const aggregator = new ResponseAggregator(
      (handler) => client.onSessionUpdate(sessionId, handler),
      timeoutMs,
    );
    const collectPromise = aggregator.collect();

    // 3. Send the prompt
    const promptResult = await client.sendRequest<SessionPromptResult>(
      AcpMethods.SESSION_PROMPT,
      { sessionId, prompt: buildPromptBlocks(prompt, context) },
    );

    // 4. Signal the aggregator that the prompt is complete
    aggregator.signal(promptResult.stopReason);

    // 5. Wait for the aggregated result
    return await collectPromise;
  } finally {
    // 6. Always destroy the session
    await client.sendRequest(AcpMethods.SESSION_DESTROY, { sessionId }).catch(() => {
      // Best-effort cleanup — don't fail the tool call
    });
  }
}

/**
 * Handler for the copilot_prompt tool.
 * Creates a temporary session, sends the prompt, collects response, destroys session.
 */
export async function copilotPromptHandler(
  input: CopilotPromptInput,
  deps: ToolDeps,
): Promise<PromptResult> {
  const client = await deps.processManager.ensure();
  const workingDirectory = input.workingDirectory ?? process.cwd();

  return executeOneShot(
    client,
    input.prompt,
    workingDirectory,
    input.context,
  );
}
