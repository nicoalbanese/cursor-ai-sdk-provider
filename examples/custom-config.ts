import { generateText } from 'ai';
import { createCursor } from '../src/index';

async function main() {
  const provider = createCursor({
    local: {
      cwd: process.cwd(),
      settingSources: ['project'],
    },
    name: 'cursor-ai-sdk-provider local example',
  });

  const result = await generateText({
    model: provider('composer-2'),
    prompt:
      'Inspect the current repository context and summarize the provider package in two sentences.',
    providerOptions: {
      cursor: {
        params: [{ id: 'thinking', value: 'high' }],
      },
    },
  });

  console.log(result.text);
  console.log('\nCursor metadata:', result.providerMetadata?.cursor);
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});
