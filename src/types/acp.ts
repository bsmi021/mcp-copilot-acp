/**
 * ACP (Agent Client Protocol) type definitions and Zod schemas.
 * Protocol version: 2025-09-01 (protocolVersion: 1)
 * Transport: JSON-RPC 2.0 over NDJSON (newline-delimited JSON)
 */

import { z } from 'zod';

// ============================================================
// JSON-RPC 2.0 Primitives
// ============================================================

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

export const JsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;

export const JsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcNotification = z.infer<typeof JsonRpcNotificationSchema>;

/**
 * Discriminated union for any incoming JSON-RPC message.
 * - Has `id` + `method` → incoming request
 * - Has `id` + (`result` | `error`) → response to our request
 * - Has `method` only (no `id`) → notification
 */
export const JsonRpcMessageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: JsonRpcErrorSchema.optional(),
});
export type JsonRpcMessage = z.infer<typeof JsonRpcMessageSchema>;

// ============================================================
// ACP Initialize
// ============================================================

export const ClientCapabilitiesSchema = z.object({
  fileSystem: z
    .object({
      read: z.boolean().optional(),
      write: z.boolean().optional(),
    })
    .optional(),
  terminal: z
    .union([
      z.boolean(),
      z.object({ create: z.boolean().optional() }),
    ])
    .optional(),
});
export type ClientCapabilities = z.infer<typeof ClientCapabilitiesSchema>;

export const ClientInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
});
export type ClientInfo = z.infer<typeof ClientInfoSchema>;

export const InitializeParamsSchema = z.object({
  protocolVersion: z.number(),
  clientCapabilities: ClientCapabilitiesSchema,
  clientInfo: ClientInfoSchema,
});
export type InitializeParams = z.infer<typeof InitializeParamsSchema>;

export const AgentCapabilitiesSchema = z.object({
  streaming: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
}).passthrough();
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

export const AgentInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
}).passthrough();
export type AgentInfo = z.infer<typeof AgentInfoSchema>;

export const InitializeResultSchema = z.object({
  protocolVersion: z.number(),
  agentCapabilities: AgentCapabilitiesSchema.optional(),
  agentInfo: AgentInfoSchema.optional(),
});
export type InitializeResult = z.infer<typeof InitializeResultSchema>;

// ============================================================
// ACP Session
// ============================================================

/** MCP server config passed to Copilot for a session */
export const McpServerConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const SessionNewParamsSchema = z.object({
  cwd: z.string().optional(),
  mcpServers: z.array(McpServerConfigSchema),
});
export type SessionNewParams = z.infer<typeof SessionNewParamsSchema>;

export const SessionNewResultSchema = z.object({
  sessionId: z.string(),
});
export type SessionNewResult = z.infer<typeof SessionNewResultSchema>;

// ============================================================
// ACP Content Blocks
// ============================================================

export const TextContentBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});
export type TextContentBlock = z.infer<typeof TextContentBlockSchema>;

export const ImageContentBlockSchema = z.object({
  type: z.literal('image'),
  data: z.string(),
  mimeType: z.string(),
});
export type ImageContentBlock = z.infer<typeof ImageContentBlockSchema>;

export const ResourceContentBlockSchema = z.object({
  type: z.literal('resource'),
  resource: z.object({
    uri: z.string(),
    text: z.string().optional(),
    blob: z.string().optional(),
    mimeType: z.string().optional(),
  }),
});
export type ResourceContentBlock = z.infer<typeof ResourceContentBlockSchema>;

export const ResourceLinkContentBlockSchema = z.object({
  type: z.literal('resource_link'),
  uri: z.string(),
  name: z.string().optional(),
});
export type ResourceLinkContentBlock = z.infer<typeof ResourceLinkContentBlockSchema>;

export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextContentBlockSchema,
  ImageContentBlockSchema,
  ResourceContentBlockSchema,
  ResourceLinkContentBlockSchema,
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// ============================================================
// ACP Session Prompt
// ============================================================

export const SessionPromptParamsSchema = z.object({
  sessionId: z.string(),
  prompt: z.array(ContentBlockSchema),
});
export type SessionPromptParams = z.infer<typeof SessionPromptParamsSchema>;

export const SessionPromptResultSchema = z.object({
  stopReason: z.string(),
});
export type SessionPromptResult = z.infer<typeof SessionPromptResultSchema>;

// ============================================================
// ACP Session Update Notifications
// ============================================================

export const AgentMessageChunkSchema = z.object({
  sessionUpdate: z.literal('agent_message_chunk'),
  content: TextContentBlockSchema,
});
export type AgentMessageChunk = z.infer<typeof AgentMessageChunkSchema>;

export const AgentThoughtChunkSchema = z.object({
  sessionUpdate: z.literal('agent_thought_chunk'),
  content: TextContentBlockSchema,
});
export type AgentThoughtChunk = z.infer<typeof AgentThoughtChunkSchema>;

export const PlanEntrySchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  status: z.string().optional(),
});
export type PlanEntry = z.infer<typeof PlanEntrySchema>;

export const PlanUpdateSchema = z.object({
  sessionUpdate: z.literal('plan'),
  entries: z.array(PlanEntrySchema),
});
export type PlanUpdate = z.infer<typeof PlanUpdateSchema>;

export const ToolCallUpdateSchema = z.object({
  sessionUpdate: z.literal('tool_call'),
  toolCallId: z.string(),
  title: z.string().optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
});
export type ToolCallUpdate = z.infer<typeof ToolCallUpdateSchema>;

export const ToolCallContentUpdateSchema = z.object({
  sessionUpdate: z.literal('tool_call_update'),
  toolCallId: z.string(),
  status: z.string().optional(),
  content: z.array(ContentBlockSchema).optional(),
});
export type ToolCallContentUpdate = z.infer<typeof ToolCallContentUpdateSchema>;

export const SessionUpdateSchema = z.discriminatedUnion('sessionUpdate', [
  AgentMessageChunkSchema,
  AgentThoughtChunkSchema,
  PlanUpdateSchema,
  ToolCallUpdateSchema,
  ToolCallContentUpdateSchema,
]);
export type SessionUpdate = z.infer<typeof SessionUpdateSchema>;

export const SessionUpdateParamsSchema = z.object({
  sessionId: z.string(),
  update: SessionUpdateSchema,
});
export type SessionUpdateParams = z.infer<typeof SessionUpdateParamsSchema>;

// ============================================================
// Incoming Requests from Copilot
// ============================================================

export const RequestPermissionParamsSchema = z.object({
  sessionId: z.string(),
  toolCall: z.object({
    toolCallId: z.string(),
    title: z.string().optional(),
    kind: z.string().optional(),
  }),
  options: z.array(
    z.object({
      optionId: z.string(),
      title: z.string().optional(),
    })
  ),
});
export type RequestPermissionParams = z.infer<typeof RequestPermissionParamsSchema>;

export const RequestPermissionResultSchema = z.object({
  outcome: z.object({
    outcome: z.enum(['selected', 'cancelled']),
    optionId: z.string().optional(),
  }),
});
export type RequestPermissionResult = z.infer<typeof RequestPermissionResultSchema>;

export const FsReadTextFileParamsSchema = z.object({
  sessionId: z.string(),
  path: z.string(),
  line: z.number().optional(),
  limit: z.number().optional(),
});
export type FsReadTextFileParams = z.infer<typeof FsReadTextFileParamsSchema>;

export const FsReadTextFileResultSchema = z.object({
  content: z.string(),
});
export type FsReadTextFileResult = z.infer<typeof FsReadTextFileResultSchema>;

export const FsWriteTextFileParamsSchema = z.object({
  sessionId: z.string(),
  path: z.string(),
  content: z.string(),
});
export type FsWriteTextFileParams = z.infer<typeof FsWriteTextFileParamsSchema>;

export const FsWriteTextFileResultSchema = z.object({});
export type FsWriteTextFileResult = z.infer<typeof FsWriteTextFileResultSchema>;

// ============================================================
// ACP Protocol Constants
// ============================================================

/** ACP protocol version per 2025-09-01 spec */
export const ACP_PROTOCOL_VERSION = 1;

/** JSON-RPC method names used in ACP */
export const AcpMethods = {
  INITIALIZE: 'initialize',
  SESSION_NEW: 'session/new',
  SESSION_PROMPT: 'session/prompt',
  SESSION_UPDATE: 'session/update',
  SESSION_DESTROY: 'session/destroy',
  REQUEST_PERMISSION: 'session/request_permission',
  FS_READ_TEXT_FILE: 'fs/read_text_file',
  FS_WRITE_TEXT_FILE: 'fs/write_text_file',
} as const;
