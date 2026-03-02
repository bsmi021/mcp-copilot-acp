/**
 * copilot_compare tool — Run a prompt through Copilot for comparison.
 * Useful for comparing Claude Code's output against Copilot's response.
 */

import type { ToolDeps, CopilotCompareInput, CompareResult } from '../types/index.js';
import { CopilotCompareInputSchema } from '../types/index.js';
import { executeOneShot } from './copilot-prompt.js';

export { CopilotCompareInputSchema as copilotCompareSchema };

/**
 * Handler for the copilot_compare tool.
 * Runs a prompt through Copilot and returns the response with timing metadata.
 */
export async function copilotCompareHandler(
  input: CopilotCompareInput,
  deps: ToolDeps,
): Promise<CompareResult> {
  const client = await deps.processManager.ensure();
  const workingDirectory = input.workingDirectory ?? process.cwd();

  const startTime = Date.now();

  const copilotResponse = await executeOneShot(
    client,
    input.prompt,
    workingDirectory,
  );

  const durationMs = Date.now() - startTime;

  return {
    copilotResponse,
    metadata: {
      durationMs,
      timestamp: new Date().toISOString(),
    },
  };
}
