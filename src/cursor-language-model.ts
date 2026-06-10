import {
  NoSuchModelError,
  type EmbeddingModelV3,
  type ImageModelV3,
  type JSONObject,
  type JSONValue,
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
  type LanguageModelV3Content,
  type LanguageModelV3FinishReason,
  type LanguageModelV3GenerateResult,
  type LanguageModelV3StreamPart,
  type LanguageModelV3StreamResult,
  type ProviderV3,
  type SharedV3ProviderMetadata,
  type SharedV3Warning,
} from '@ai-sdk/provider';
import { loadApiKey } from '@ai-sdk/provider-utils';
import {
  Agent,
  type AgentOptions,
  type ModelParameterValue,
  type Run,
  type SDKAgent,
} from '@cursor/sdk';
import {
  convertToCursorMessage,
  stringifyUnknown,
  toNonNullJsonValue,
} from './convert-to-cursor-message';
import type {
  CursorAgentFactory,
  CursorChatModelId,
  CursorLanguageModelSettings,
  CursorProviderOptions,
  CursorProviderSettings,
} from './cursor-settings';
import {
  createUsageTracker,
  type UsageTracker,
} from './usage';

type CursorSendOptions = NonNullable<Parameters<SDKAgent['send']>[1]>;

interface ResolvedCursorProviderSettings extends CursorProviderSettings {
  agentFactory: CursorAgentFactory;
}

export class CursorLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3';
  readonly provider = 'cursor';
  readonly supportedUrls = {
    'image/*': [/^https?:\/\//],
  };

  constructor(
    readonly modelId: string,
    private readonly settings: CursorLanguageModelSettings,
    private readonly providerSettings: ResolvedCursorProviderSettings,
  ) {}

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const usageTracker = createUsageTracker();
    const conversion = convertToCursorMessage(options);
    const warnings = [...conversion.warnings, ...collectCallWarnings(options)];
    const callOptions = parseCursorProviderOptions(options);
    const agent = await this.createAgent(callOptions);

    let abortHandler: (() => void) | undefined;

    try {
      const sendOptions = this.createSendOptions(callOptions, usageTracker);
      const run = await agent.send(conversion.message, sendOptions);

      if (options.abortSignal !== undefined) {
        abortHandler = () => {
          void run.cancel();
        };

        if (options.abortSignal.aborted) {
          await run.cancel();
        } else {
          options.abortSignal.addEventListener('abort', abortHandler, {
            once: true,
          });
        }
      }

      const content = await collectGenerateContentFromRun(run);
      const result = await run.wait();
      const resultText = result.result ?? run.result ?? '';
      const finalContent: LanguageModelV3Content[] =
        content.length > 0
          ? content
          : resultText.length > 0
            ? [{ type: 'text', text: resultText }]
            : [];
      const providerMetadata = buildProviderMetadata(
        run.agentId,
        result.id,
        result.status,
        result.durationMs,
        usageTracker.toProviderMetadata(),
      );

      return {
        content: finalContent,
        finishReason: finishReasonFromStatus(result.status),
        usage: usageTracker.toLanguageModelUsage(),
        providerMetadata,
        response: {
          id: result.id,
          timestamp: new Date(),
          modelId: result.model?.id ?? this.modelId,
        },
        warnings,
      };
    } finally {
      if (abortHandler !== undefined && options.abortSignal !== undefined) {
        options.abortSignal.removeEventListener('abort', abortHandler);
      }

      await agent[Symbol.asyncDispose]();
    }
  }

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const usageTracker = createUsageTracker();
    const conversion = convertToCursorMessage(options);
    const warnings = [...conversion.warnings, ...collectCallWarnings(options)];
    const callOptions = parseCursorProviderOptions(options);
    const agent = await this.createAgent(callOptions);
    const sendOptions = this.createSendOptions(callOptions, usageTracker);
    const run = await agent.send(conversion.message, sendOptions);
    const modelId = this.modelId;

    let cancelled = false;

    return {
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          let abortHandler: (() => void) | undefined;

          try {
            controller.enqueue({ type: 'stream-start', warnings });
            controller.enqueue({
              type: 'response-metadata',
              id: run.id,
              timestamp: new Date(),
              modelId: run.model?.id ?? modelId,
            });

            if (options.abortSignal !== undefined) {
              abortHandler = () => {
                void run.cancel();
              };

              if (options.abortSignal.aborted) {
                await run.cancel();
              } else {
                options.abortSignal.addEventListener('abort', abortHandler, {
                  once: true,
                });
              }
            }

            const state = createStreamState();

            for await (const event of run.stream()) {
              if (cancelled) {
                break;
              }

              for (const part of convertCursorEventToStreamParts(
                event,
                state,
                options.includeRawChunks === true,
              )) {
                controller.enqueue(part);
              }
            }

            for (const part of closeOpenStreamParts(state)) {
              controller.enqueue(part);
            }

            const result = await run.wait();
            const providerMetadata = buildProviderMetadata(
              run.agentId,
              result.id,
              result.status,
              result.durationMs,
              usageTracker.toProviderMetadata(),
            );

            controller.enqueue({
              type: 'finish',
              usage: usageTracker.toLanguageModelUsage(),
              finishReason: finishReasonFromStatus(result.status),
              providerMetadata,
            });
          } catch (error) {
            if (!cancelled) {
              controller.enqueue({ type: 'error', error });
            }
          } finally {
            if (abortHandler !== undefined && options.abortSignal !== undefined) {
              options.abortSignal.removeEventListener('abort', abortHandler);
            }

            await agent[Symbol.asyncDispose]();
            controller.close();
          }
        },
        async cancel() {
          cancelled = true;
          await run.cancel();
          await agent[Symbol.asyncDispose]();
        },
      }),
    };
  }

  private async createAgent(
    callOptions: CursorProviderOptions,
  ): Promise<Awaited<ReturnType<CursorAgentFactory>>> {
    const agentOptions = this.createAgentOptions(callOptions);
    return this.providerSettings.agentFactory(agentOptions);
  }

  private createAgentOptions(callOptions: CursorProviderOptions): AgentOptions {
    const model = this.createModelSelection(callOptions);
    const apiKey = loadApiKey({
      apiKey: this.providerSettings.apiKey,
      environmentVariableName: 'CURSOR_API_KEY',
      description: 'Cursor API key',
    });
    const agentOptions: AgentOptions = { apiKey, model };
    const name = this.settings.name ?? this.providerSettings.name;
    const cloud = this.settings.cloud ?? this.providerSettings.cloud;
    const local = this.settings.local ?? this.providerSettings.local;
    const mcpServers =
      this.settings.mcpServers ?? this.providerSettings.mcpServers;
    const agents = this.settings.agents ?? this.providerSettings.agents;
    const agentId = this.settings.agentId ?? this.providerSettings.agentId;

    if (name !== undefined) {
      agentOptions.name = name;
    }

    if (cloud !== undefined) {
      agentOptions.cloud = cloud;
    } else {
      agentOptions.local = local ?? { cwd: process.cwd() };
    }

    if (mcpServers !== undefined) {
      agentOptions.mcpServers = mcpServers;
    }

    if (agents !== undefined) {
      agentOptions.agents = agents;
    }

    if (agentId !== undefined) {
      agentOptions.agentId = agentId;
    }

    return agentOptions;
  }

  private createModelSelection(callOptions: CursorProviderOptions) {
    const model = { id: callOptions.modelId ?? this.modelId };
    const params =
      callOptions.params ?? this.settings.params ?? this.providerSettings.params;

    if (params === undefined || params.length === 0) {
      return model;
    }

    return { id: model.id, params };
  }

  private createSendOptions(
    callOptions: CursorProviderOptions,
    usageTracker: UsageTracker,
  ): CursorSendOptions {
    const sendOptions: CursorSendOptions = {
      onDelta: ({ update }) => {
        usageTracker.record(update);
      },
    };

    if (callOptions.local !== undefined) {
      sendOptions.local = callOptions.local;
    }

    return sendOptions;
  }
}

export interface CursorProvider extends ProviderV3 {
  (modelId: CursorChatModelId, settings?: CursorLanguageModelSettings): LanguageModelV3;
  languageModel(
    modelId: CursorChatModelId,
    settings?: CursorLanguageModelSettings,
  ): LanguageModelV3;
}

export function createCursor(
  options: CursorProviderSettings = {},
): CursorProvider {
  const agentFactory = options.agentFactory ?? Agent.create;
  const providerSettings: ResolvedCursorProviderSettings = {
    ...options,
    agentFactory,
  };

  const createLanguageModel = (
    modelId: CursorChatModelId,
    settings: CursorLanguageModelSettings = {},
  ) => new CursorLanguageModel(modelId, settings, providerSettings);

  const specificationVersion: 'v3' = 'v3';
  const provider: CursorProvider = Object.assign(
    (
      modelId: CursorChatModelId,
      settings?: CursorLanguageModelSettings,
    ) => createLanguageModel(modelId, settings),
    {
      specificationVersion,
      languageModel: createLanguageModel,
      embeddingModel: (modelId: string): EmbeddingModelV3 => {
        throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
      },
      textEmbeddingModel: (modelId: string): EmbeddingModelV3 => {
        throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
      },
      imageModel: (modelId: string): ImageModelV3 => {
        throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
      },
    },
  );

  return provider;
}

export const cursor = createCursor();

function parseCursorProviderOptions(
  options: LanguageModelV3CallOptions,
): CursorProviderOptions {
  const providerOptions = options.providerOptions?.cursor;
  if (providerOptions === undefined) {
    return {};
  }

  const cursorOptions: CursorProviderOptions = {};

  if (typeof providerOptions.modelId === 'string') {
    cursorOptions.modelId = providerOptions.modelId;
  }

  const params = readModelParams(providerOptions.params);
  if (params !== undefined) {
    cursorOptions.params = params;
  }

  const local = providerOptions.local;
  if (isJsonObject(local) && typeof local.force === 'boolean') {
    cursorOptions.local = { force: local.force };
  }

  return cursorOptions;
}

function readModelParams(value: unknown): ModelParameterValue[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const params: ModelParameterValue[] = [];
  for (const item of value) {
    if (!isJsonObject(item)) {
      continue;
    }

    const id = item.id;
    const paramValue = item.value;
    if (typeof id === 'string' && typeof paramValue === 'string') {
      params.push({ id, value: paramValue });
    }
  }

  return params.length === 0 ? undefined : params;
}

function collectCallWarnings(
  options: LanguageModelV3CallOptions,
): SharedV3Warning[] {
  const warnings: SharedV3Warning[] = [];

  addUnsupportedWarning(warnings, options.maxOutputTokens, 'maxOutputTokens');
  addUnsupportedWarning(warnings, options.temperature, 'temperature');
  addUnsupportedWarning(warnings, options.stopSequences, 'stopSequences');
  addUnsupportedWarning(warnings, options.topP, 'topP');
  addUnsupportedWarning(warnings, options.topK, 'topK');
  addUnsupportedWarning(warnings, options.presencePenalty, 'presencePenalty');
  addUnsupportedWarning(warnings, options.frequencyPenalty, 'frequencyPenalty');
  addUnsupportedWarning(warnings, options.seed, 'seed');

  if (options.tools !== undefined && options.tools.length > 0) {
    warnings.push({
      type: 'unsupported',
      feature: 'AI SDK tools',
      details:
        'Cursor SDK agents execute Cursor tools, MCP servers, and subagents. AI SDK function tools are not passed through.',
    });
  }

  addUnsupportedWarning(warnings, options.toolChoice, 'toolChoice');

  return warnings;
}

function addUnsupportedWarning(
  warnings: SharedV3Warning[],
  value: unknown,
  feature: string,
) {
  if (value !== undefined) {
    warnings.push({ type: 'unsupported', feature });
  }
}

function finishReasonFromStatus(
  status: 'finished' | 'error' | 'cancelled',
): LanguageModelV3FinishReason {
  switch (status) {
    case 'finished':
      return { unified: 'stop', raw: status };
    case 'error':
      return { unified: 'error', raw: status };
    case 'cancelled':
      return { unified: 'other', raw: status };
  }
}

async function collectGenerateContentFromRun(
  run: Run,
): Promise<LanguageModelV3Content[]> {
  const content: LanguageModelV3Content[] = [];
  const seenToolCalls = new Set<string>();
  let generatedToolCallIndex = 0;

  for await (const event of run.stream()) {
    if (isJsonObject(event) && event.type === 'assistant') {
      const message = event.message;
      if (isJsonObject(message) && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (
            isJsonObject(block) &&
            block.type === 'text' &&
            typeof block.text === 'string'
          ) {
            content.push({ type: 'text', text: block.text });
          }

          if (
            isJsonObject(block) &&
            block.type === 'tool_use' &&
            typeof block.name === 'string'
          ) {
            const toolCallId =
              typeof block.id === 'string'
                ? block.id
                : `cursor-tool-${generatedToolCallIndex}`;
            generatedToolCallIndex += 1;
            addToolCallContent({
              content,
              seenToolCalls,
              toolCallId,
              toolName: block.name,
              input: block.input,
            });
          }
        }
      }
    }

    if (isJsonObject(event) && event.type === 'thinking') {
      const text = event.text;
      if (typeof text === 'string') {
        content.push({ type: 'reasoning', text });
      }
    }

    if (isJsonObject(event) && event.type === 'tool_call') {
      const callId = event.call_id;
      const name = event.name;
      const status = event.status;

      if (typeof callId === 'string' && typeof name === 'string') {
        if (status === 'running') {
          addToolCallContent({
            content,
            seenToolCalls,
            toolCallId: callId,
            toolName: name,
            input: event.args,
          });
        }

        if (status === 'completed' || status === 'error') {
          addToolCallContent({
            content,
            seenToolCalls,
            toolCallId: callId,
            toolName: name,
            input: event.args,
          });
          content.push({
            type: 'tool-result',
            toolCallId: callId,
            toolName: name,
            result: toNonNullJsonValue(event.result),
            isError: status === 'error',
            dynamic: true,
          });
        }
      }
    }
  }

  return content;
}

function addToolCallContent({
  content,
  seenToolCalls,
  toolCallId,
  toolName,
  input,
}: {
  content: LanguageModelV3Content[];
  seenToolCalls: Set<string>;
  toolCallId: string;
  toolName: string;
  input: unknown;
}) {
  if (seenToolCalls.has(toolCallId)) {
    return;
  }

  seenToolCalls.add(toolCallId);
  content.push({
    type: 'tool-call',
    toolCallId,
    toolName,
    input: stringifyUnknown(input ?? {}),
    providerExecuted: true,
    dynamic: true,
  });
}

interface StreamState {
  textOpen: boolean;
  reasoningOpen: boolean;
  seenToolCalls: Set<string>;
  generatedToolCallIndex: number;
}

function createStreamState(): StreamState {
  return {
    textOpen: false,
    reasoningOpen: false,
    seenToolCalls: new Set(),
    generatedToolCallIndex: 0,
  };
}

function convertCursorEventToStreamParts(
  event: unknown,
  state: StreamState,
  includeRawChunks: boolean,
): LanguageModelV3StreamPart[] {
  const parts: LanguageModelV3StreamPart[] = [];

  if (isJsonObject(event) && event.type === 'assistant') {
    const message = event.message;
    if (isJsonObject(message) && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isJsonObject(block)) {
          continue;
        }

        if (block.type === 'text' && typeof block.text === 'string') {
          if (!state.textOpen) {
            parts.push({ type: 'text-start', id: 'cursor-text' });
            state.textOpen = true;
          }

          parts.push({
            type: 'text-delta',
            id: 'cursor-text',
            delta: block.text,
          });
        }

        if (block.type === 'tool_use' && typeof block.name === 'string') {
          const toolCallId =
            typeof block.id === 'string'
              ? block.id
              : `cursor-tool-${state.generatedToolCallIndex}`;
          if (typeof block.id !== 'string') {
            state.generatedToolCallIndex += 1;
          }

          addStreamToolCallPart({
            parts,
            state,
            toolCallId,
            toolName: block.name,
            input: block.input,
          });
        }
      }
    }
  }

  if (isJsonObject(event) && event.type === 'thinking') {
    const text = event.text;
    if (typeof text === 'string') {
      if (!state.reasoningOpen) {
        parts.push({ type: 'reasoning-start', id: 'cursor-reasoning' });
        state.reasoningOpen = true;
      }

      parts.push({
        type: 'reasoning-delta',
        id: 'cursor-reasoning',
        delta: text,
      });
    }
  }

  if (isJsonObject(event) && event.type === 'tool_call') {
    const callId = event.call_id;
    const name = event.name;
    const status = event.status;

    if (typeof callId === 'string' && typeof name === 'string') {
      if (status === 'running') {
        parts.push({
          type: 'tool-input-start',
          id: callId,
          toolName: name,
          providerExecuted: true,
          dynamic: true,
        });

        if (event.args !== undefined) {
          parts.push({
            type: 'tool-input-delta',
            id: callId,
            delta: stringifyUnknown(event.args),
          });
        }

        parts.push({ type: 'tool-input-end', id: callId });
        addStreamToolCallPart({
          parts,
          state,
          toolCallId: callId,
          toolName: name,
          input: event.args,
        });
      }

      if (status === 'completed' || status === 'error') {
        addStreamToolCallPart({
          parts,
          state,
          toolCallId: callId,
          toolName: name,
          input: event.args,
        });
        parts.push({
          type: 'tool-result',
          toolCallId: callId,
          toolName: name,
          result: toNonNullJsonValue(event.result),
          isError: status === 'error',
          dynamic: true,
        });
      }
    }
  }

  if (includeRawChunks) {
    parts.push({ type: 'raw', rawValue: event });
  }

  return parts;
}

function addStreamToolCallPart({
  parts,
  state,
  toolCallId,
  toolName,
  input,
}: {
  parts: LanguageModelV3StreamPart[];
  state: StreamState;
  toolCallId: string;
  toolName: string;
  input: unknown;
}) {
  if (state.seenToolCalls.has(toolCallId)) {
    return;
  }

  state.seenToolCalls.add(toolCallId);
  parts.push({
    type: 'tool-call',
    toolCallId,
    toolName,
    input: stringifyUnknown(input ?? {}),
    providerExecuted: true,
    dynamic: true,
  });
}

function closeOpenStreamParts(state: StreamState): LanguageModelV3StreamPart[] {
  const parts: LanguageModelV3StreamPart[] = [];

  if (state.textOpen) {
    parts.push({ type: 'text-end', id: 'cursor-text' });
  }

  if (state.reasoningOpen) {
    parts.push({ type: 'reasoning-end', id: 'cursor-reasoning' });
  }

  return parts;
}

function buildProviderMetadata(
  agentId: string,
  runId: string,
  status: 'finished' | 'error' | 'cancelled',
  durationMs: number | undefined,
  usageMetadata: SharedV3ProviderMetadata | undefined,
): SharedV3ProviderMetadata {
  const cursorMetadata: JSONObject = {
    agentId,
    runId,
    status,
  };

  if (durationMs !== undefined) {
    cursorMetadata.durationMs = durationMs;
  }

  const usageCursorMetadata = usageMetadata?.cursor;
  if (usageCursorMetadata !== undefined) {
    for (const key of Object.keys(usageCursorMetadata)) {
      cursorMetadata[key] = usageCursorMetadata[key];
    }
  }

  return { cursor: cursorMetadata };
}

function isJsonObject(value: unknown): value is Record<string, JSONValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
