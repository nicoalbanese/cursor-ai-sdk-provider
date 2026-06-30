import { resolve } from 'node:path';
import { streamText } from 'ai';
import { createCursor } from '../src/index';

async function main() {
  const targetDirectory = resolve(process.argv[2] ?? process.cwd());
  const provider = createCursor({
    local: { cwd: targetDirectory },
    mcpServers: {
      filesystem: {
        type: 'stdio',
        command: 'bunx',
        args: ['@modelcontextprotocol/server-filesystem', targetDirectory],
      },
    },
  });

  console.log(`Target directory: ${targetDirectory}`);
  console.log('Streaming response:\n');

  const result = streamText({
    model: provider('composer-2'),
    prompt:
      'Use the filesystem MCP server to list the allowed directories, then summarize the target directory at a high level. Do not modify files.',
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }

  const finalStep = await result.finalStep;
  console.log('\n\nCursor metadata:', finalStep.providerMetadata?.cursor);
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});
