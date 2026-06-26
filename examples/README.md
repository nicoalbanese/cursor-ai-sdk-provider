# Cursor AI SDK Provider Examples

This directory contains runnable examples for the Cursor AI SDK provider. They are intentionally small and focused on the patterns users need first.

## Prerequisites

Install dependencies and set a Cursor API key:

```bash
bun install
export CURSOR_API_KEY="your-key"
```

The example scripts also load `.env.local`, so you can create this file instead:

```bash
CURSOR_API_KEY="your-key"
```

Examples import from `../src/index.ts` so they can run from the repository without a build step. Published package consumers should import from `cursor-ai-sdk-provider` instead.

Use the package scripts below. They load `.env.local` and invoke Node through `tsx`; running these files directly with Bun's TypeScript runtime can fail because the Cursor SDK uses Node HTTP/2 transport internals.

## Quick Start

```bash
bun run example:check
bun run example:basic
bun run example:streaming
bun run example:tool-streaming
```

## Examples

| File | Purpose |
| --- | --- |
| `check-setup.ts` | Verifies `CURSOR_API_KEY` and lists available Cursor models. |
| `basic-usage.ts` | Runs a simple `generateText` call and prints usage plus Cursor metadata. |
| `streaming.ts` | Streams text with `streamText` and prints simple timing stats. |
| `tool-streaming.ts` | Prints provider-executed Cursor tool calls from `stream`. |
| `custom-config.ts` | Shows local runtime settings, model params, and per-call provider options. |
| `cloud-agent.ts` | Runs against Cursor cloud with a repo from environment variables. |
| `mcp-filesystem.ts` | Configures a stdio MCP filesystem server for a local agent. |
| `images.ts` | Sends a local image with a multimodal prompt. |
| `limitations.ts` | Demonstrates unsupported AI SDK settings and Cursor-specific alternatives. |

## Cloud Example

The cloud example requires an explicit repo URL connected to your Cursor account or team:

```bash
CURSOR_EXAMPLE_REPO_URL="https://github.com/your-org/your-repo" bun run example:cloud
```

Optional variables:

```bash
CURSOR_EXAMPLE_STARTING_REF="main"
CURSOR_EXAMPLE_AUTO_PR="1"
```

Use a plain branch, tag, or SHA for `CURSOR_EXAMPLE_STARTING_REF`; do not include `origin/`.
`CURSOR_EXAMPLE_AUTO_PR` defaults to disabled.

## Image Example

```bash
bun run example:images -- /absolute/path/to/image.png
```

Supported extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`.

## MCP Filesystem Example

```bash
bun run example:mcp-filesystem
bun run example:mcp-filesystem -- /absolute/path/to/inspect
```

This uses `bunx @modelcontextprotocol/server-filesystem` through Cursor's inline MCP server configuration.

## Learning Path

1. Start with `check-setup.ts`, then `basic-usage.ts`.
2. Use `streaming.ts` for responsive UI patterns.
3. Use `tool-streaming.ts` to understand how Cursor tool calls surface through `stream`.
4. Use `custom-config.ts` to learn local runtime and model parameter configuration.
5. Use `mcp-filesystem.ts` and `images.ts` for agent capabilities beyond plain text.
6. Read `limitations.ts` before relying on AI SDK sampling options or function tools.
