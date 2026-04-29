# Cursor AI SDK Provider

Community AI SDK provider for the Cursor SDK public beta.

This package adapts Cursor agents to the AI SDK language model interface, so you can call Cursor models with `generateText` and `streamText`.

```ts
import { generateText } from 'ai';
import { cursor } from 'cursor-ai-sdk-provider';

const result = await generateText({
  model: cursor('composer-2'),
  prompt: 'Summarize this repository.',
});

console.log(result.text);
```

## Install

```bash
bun add cursor-ai-sdk-provider ai @cursor/sdk
```

Set `CURSOR_API_KEY`, or pass `apiKey` to `createCursor`.

```bash
export CURSOR_API_KEY="your-key"
```

## Local Agents

By default, calls run a local Cursor agent against `process.cwd()`.

```ts
import { createCursor } from 'cursor-ai-sdk-provider';

const cursor = createCursor({
  local: { cwd: '/path/to/repo' },
});
```

## Cloud Agents

Pass Cursor cloud options to run in Cursor-hosted or self-hosted cloud environments.

```ts
const cursor = createCursor({
  cloud: {
    repos: [
      { url: 'https://github.com/your-org/your-repo', startingRef: 'main' },
    ],
    autoCreatePR: true,
  },
});
```

## Model Parameters

Use `Cursor.models.list()` from `@cursor/sdk` to discover valid model IDs and parameters. Pass default params when creating the model, or per call through AI SDK provider options.

```ts
await generateText({
  model: cursor('composer-2'),
  prompt: 'Plan this refactor.',
  providerOptions: {
    cursor: {
      params: [{ id: 'thinking', value: 'high' }],
    },
  },
});
```

## Cursor Tools

AI SDK function tools are not forwarded to Cursor. Use Cursor MCP servers and subagents instead.

```ts
const cursor = createCursor({
  mcpServers: {
    docs: {
      type: 'http',
      url: 'https://example.com/mcp',
    },
  },
  agents: {
    'code-reviewer': {
      description: 'Reviews code for bugs and regressions.',
      prompt: 'Review the code carefully and report concrete findings.',
      model: 'inherit',
    },
  },
});
```

## Limitations

- Language models only. Cursor does not expose embeddings or image generation through this provider.
- Each AI SDK call creates, runs, and disposes one Cursor agent unless you pass a stable `agentId`.
- AI SDK sampling settings such as `temperature`, `topP`, and `stopSequences` are reported as unsupported warnings because the Cursor SDK agent API does not expose them directly.
- JSON response format is implemented as a prompt instruction, not native constrained decoding.
