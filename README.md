# Cursor AI SDK Provider

> Status: quick proof of concept. This package has not been published to npm yet, and the API may change.

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

Repository examples also load `.env.local`, so this works too:

```bash filename=".env.local"
CURSOR_API_KEY="your-key"
```

## Local Agents

By default, calls create a local Cursor agent against `process.cwd()`. Your workspace files are read from your machine, and the model/runtime calls are authenticated through Cursor with `CURSOR_API_KEY`. This does not create a Cursor cloud VM unless you pass `cloud` options.

```ts
import { createCursor } from 'cursor-ai-sdk-provider';

const cursor = createCursor({
  local: { cwd: '/path/to/repo' },
});
```

## Examples

Runnable examples live in [`examples/`](examples/). From this repository, run them through the package scripts:

```bash
bun run example:check
bun run example:basic
bun run example:streaming
bun run example:tool-streaming
```

These scripts use Node through `tsx`. Running the files directly with Bun's TypeScript runtime can fail because the Cursor SDK uses Node HTTP/2 transport internals.
They load `.env.local` before running.

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

Cursor tool activity is exposed as provider-executed AI SDK tool events.

For streaming calls, `textStream` only includes assistant text. Use `fullStream` to observe tool calls and results:

```ts
import { streamText } from 'ai';
import { cursor } from 'cursor-ai-sdk-provider';

const result = streamText({
  model: cursor('composer-2'),
  prompt: 'Inspect this repository and summarize package.json.',
});

for await (const part of result.fullStream) {
  if (part.type === 'tool-call') {
    console.log('Tool call:', part.toolName, part.input);
  }

  if (part.type === 'tool-result') {
    console.log('Tool result:', part.toolName, part.output);
  }
}
```

For non-streaming `generateText()`, tool calls and results are available after the run finishes through the AI SDK result content and tool fields, while `result.text` remains assistant text only.

```ts
const result = await generateText({
  model: cursor('composer-2'),
  prompt: 'Inspect this repository and summarize package.json.',
});

console.log(result.text);
console.log(result.toolCalls);
console.log(result.toolResults);
```

## Limitations

- Language models only. Cursor does not expose embeddings or image generation through this provider.
- Each AI SDK call creates, runs, and disposes one Cursor agent unless you pass a stable `agentId`.
- AI SDK sampling settings such as `temperature`, `topP`, and `stopSequences` are reported as unsupported warnings because the Cursor SDK agent API does not expose them directly.
- JSON response format is implemented as a prompt instruction, not native constrained decoding.
