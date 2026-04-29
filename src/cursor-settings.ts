import type {
  AgentDefinition,
  AgentOptions,
  McpServerConfig,
  ModelParameterValue,
  SDKAgent,
} from '@cursor/sdk';

export type CursorChatModelId = 'auto' | 'composer-2' | (string & {});

export type CursorLocalOptions = NonNullable<AgentOptions['local']>;

export type CursorCloudOptions = NonNullable<AgentOptions['cloud']>;

export type CursorAgentFactory = (options: AgentOptions) => Promise<SDKAgent>;

export interface CursorLanguageModelSettings {
  /**
   * Cursor model parameters, for example `{ id: 'thinking', value: 'high' }`.
   * Use `Cursor.models.list()` from `@cursor/sdk` to discover valid parameters.
   */
  params?: ModelParameterValue[];

  /** Human-readable agent name shown in Cursor agent lists. */
  name?: string;

  /** Local Cursor agent runtime. Defaults to `{ cwd: process.cwd() }`. */
  local?: CursorLocalOptions;

  /** Cursor-hosted or self-hosted cloud runtime. Overrides `local` when set. */
  cloud?: CursorCloudOptions;

  /** Inline Cursor MCP server definitions available to this agent. */
  mcpServers?: Record<string, McpServerConfig>;

  /** Inline Cursor subagent definitions available to this agent. */
  agents?: Record<string, AgentDefinition>;

  /** Stable Cursor agent ID. Use carefully because it preserves conversation state. */
  agentId?: string;
}

export interface CursorProviderSettings extends CursorLanguageModelSettings {
  /** Cursor API key. Defaults to `CURSOR_API_KEY`. */
  apiKey?: string;

  /** Advanced hook for tests or custom agent creation. */
  agentFactory?: CursorAgentFactory;
}

export interface CursorProviderOptions {
  /** Per-call Cursor model ID override. */
  modelId?: string;

  /** Per-call Cursor model parameters. */
  params?: ModelParameterValue[];

  /** Local per-send options. */
  local?: {
    force?: boolean;
  };
}
