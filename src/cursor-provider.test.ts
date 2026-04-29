import { Buffer } from 'node:buffer';
import { describe, expect, test } from 'bun:test';
import type {
  AgentOptions,
  Run,
  RunResult,
  SDKAgent,
  SDKArtifact,
} from '@cursor/sdk';
import type { LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { convertToCursorMessage } from './convert-to-cursor-message';
import { createCursor } from './cursor-language-model';

const prompt: LanguageModelV3Prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Hello Cursor' }],
  },
];

class FakeRun implements Run {
  readonly id = 'run-1';
  readonly agentId = 'agent-1';
  private currentStatus: 'finished' | 'error' | 'cancelled' = 'finished';

  constructor(
    private readonly events: SDKEvent[] = [],
    private readonly text: string | undefined = 'Final answer',
  ) {}

  get status() {
    return this.currentStatus;
  }

  get result() {
    return this.text ?? '';
  }

  supports() {
    return true;
  }

  unsupportedReason() {
    return undefined;
  }

  async *stream() {
    for (const event of this.events) {
      yield event;
    }
  }

  async conversation() {
    return [];
  }

  async wait(): Promise<RunResult> {
    const result = {
      id: this.id,
      status: this.currentStatus,
      model: { id: 'composer-2' },
      durationMs: 10,
    };

    if (this.text !== undefined) {
      return { ...result, result: this.text };
    }

    return result;
  }

  async cancel() {
    this.currentStatus = 'cancelled';
  }

  onDidChangeStatus() {
    return () => {};
  }
}

type SDKEvent = Awaited<ReturnType<Run['stream']>> extends AsyncGenerator<infer T>
  ? T
  : never;

class FakeAgent implements SDKAgent {
  readonly agentId = 'agent-1';
  readonly model = undefined;
  readonly sentMessages: Array<string | Parameters<SDKAgent['send']>[0]> = [];
  readonly sendOptions: Array<Parameters<SDKAgent['send']>[1]> = [];
  disposed = false;

  constructor(private readonly run: Run) {}

  async send(
    message: Parameters<SDKAgent['send']>[0],
    options?: Parameters<SDKAgent['send']>[1],
  ) {
    this.sentMessages.push(message);
    this.sendOptions.push(options);
    return this.run;
  }

  close() {}

  async reload() {}

  async [Symbol.asyncDispose]() {
    this.disposed = true;
  }

  async listArtifacts(): Promise<SDKArtifact[]> {
    return [];
  }

  async downloadArtifact() {
    return Buffer.from('');
  }
}

describe('Cursor AI SDK provider', () => {
  test('converts a single user prompt without transcript labels', () => {
    const conversion = convertToCursorMessage({ prompt });

    expect(conversion.message).toBe('Hello Cursor');
    expect(conversion.warnings).toEqual([]);
  });

  test('runs generateText calls through a Cursor agent', async () => {
    let createdOptions: AgentOptions | undefined;
    let fakeAgent: FakeAgent | undefined;

    const cursor = createCursor({
      apiKey: 'test-key',
      agentFactory: async (options) => {
        createdOptions = options;
        fakeAgent = new FakeAgent(new FakeRun());
        return fakeAgent;
      },
    });

    const model = cursor('composer-2');
    const result = await model.doGenerate({ prompt });

    expect(createdOptions?.model).toEqual({ id: 'composer-2' });
    expect(createdOptions?.local).toEqual({ cwd: process.cwd() });
    expect(fakeAgent?.sentMessages[0]).toBe('Hello Cursor');
    expect(fakeAgent?.disposed).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Final answer' }]);
    expect(result.finishReason).toEqual({ unified: 'stop', raw: 'finished' });
    expect(result.providerMetadata?.cursor?.runId).toBe('run-1');
  });

  test('passes Cursor provider options to the agent run', async () => {
    let createdOptions: AgentOptions | undefined;
    let fakeAgent: FakeAgent | undefined;

    const cursor = createCursor({
      apiKey: 'test-key',
      agentFactory: async (options) => {
        createdOptions = options;
        fakeAgent = new FakeAgent(new FakeRun());
        return fakeAgent;
      },
    });

    await cursor('composer-2').doGenerate({
      prompt,
      providerOptions: {
        cursor: {
          params: [{ id: 'thinking', value: 'high' }],
          local: { force: true },
        },
      },
    });

    expect(createdOptions?.model).toEqual({
      id: 'composer-2',
      params: [{ id: 'thinking', value: 'high' }],
    });
    expect(fakeAgent?.sendOptions[0]?.local).toEqual({ force: true });
  });

  test('collects generate text from stream when wait result is empty', async () => {
    const events: SDKEvent[] = [
      {
        type: 'assistant',
        agent_id: 'agent-1',
        run_id: 'run-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Streamed answer' }],
        },
      },
    ];

    const cursor = createCursor({
      apiKey: 'test-key',
      agentFactory: async () => new FakeAgent(new FakeRun(events, undefined)),
    });

    const result = await cursor('composer-2').doGenerate({
      prompt,
      headers: { 'ai-sdk': 'internal' },
    });

    expect(result.content).toEqual([{ type: 'text', text: 'Streamed answer' }]);
    expect(result.warnings).toEqual([]);
  });

  test('collects generate tool calls and results from stream', async () => {
    const events: SDKEvent[] = [
      {
        type: 'tool_call',
        agent_id: 'agent-1',
        run_id: 'run-1',
        call_id: 'tool-1',
        name: 'Read',
        status: 'running',
        args: { path: 'package.json' },
      },
      {
        type: 'tool_call',
        agent_id: 'agent-1',
        run_id: 'run-1',
        call_id: 'tool-1',
        name: 'Read',
        status: 'completed',
        result: { ok: true },
      },
      {
        type: 'assistant',
        agent_id: 'agent-1',
        run_id: 'run-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Read package.json.' }],
        },
      },
    ];

    const cursor = createCursor({
      apiKey: 'test-key',
      agentFactory: async () => new FakeAgent(new FakeRun(events, undefined)),
    });

    const result = await cursor('composer-2').doGenerate({ prompt });

    expect(result.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'tool-1',
        toolName: 'Read',
        input: '{"path":"package.json"}',
        providerExecuted: true,
        dynamic: true,
      },
      {
        type: 'tool-result',
        toolCallId: 'tool-1',
        toolName: 'Read',
        result: { ok: true },
        isError: false,
        dynamic: true,
      },
      { type: 'text', text: 'Read package.json.' },
    ]);
  });

  test('streams Cursor thinking and assistant text events', async () => {
    const events: SDKEvent[] = [
      {
        type: 'thinking',
        agent_id: 'agent-1',
        run_id: 'run-1',
        text: 'Thinking...',
      },
      {
        type: 'assistant',
        agent_id: 'agent-1',
        run_id: 'run-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
        },
      },
    ];

    const cursor = createCursor({
      apiKey: 'test-key',
      agentFactory: async () => new FakeAgent(new FakeRun(events)),
    });

    const result = await cursor('composer-2').doStream({ prompt });
    const parts = await readStream(result.stream);

    expect(parts.map((part) => part.type)).toEqual([
      'stream-start',
      'response-metadata',
      'reasoning-start',
      'reasoning-delta',
      'text-start',
      'text-delta',
      'text-end',
      'reasoning-end',
      'finish',
    ]);
  });
});

async function readStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
) {
  const reader = stream.getReader();
  const parts: LanguageModelV3StreamPart[] = [];

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }

    parts.push(result.value);
  }

  return parts;
}
