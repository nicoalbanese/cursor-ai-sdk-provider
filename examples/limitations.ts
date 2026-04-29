import { generateText } from 'ai';
import { createCursor } from '../src/index';

async function main() {
  const provider = createCursor({
    local: { cwd: process.cwd() },
    agents: {
      'repo-summarizer': {
        description: 'Summarizes repository structure and important files.',
        prompt:
          'You summarize repository structure concisely and avoid making file changes.',
        model: 'inherit',
      },
    },
  });

  const result = await generateText({
    model: provider('composer-2'),
    prompt:
      'Explain two limitations of using an agent-backed provider through the AI SDK.',
    temperature: 0,
    maxOutputTokens: 200,
  });

  console.log(result.text);
  console.log('\nWarnings:');
  for (const warning of result.warnings ?? []) {
    switch (warning.type) {
      case 'unsupported':
      case 'compatibility':
        console.log(`- ${warning.type}: ${warning.feature}`);
        break;
      case 'other':
        console.log(`- ${warning.type}: ${warning.message}`);
        break;
    }
  }

  console.log('\nCursor-specific alternative:');
  console.log('- Use Cursor model params through providerOptions.cursor.params.');
  console.log('- Use Cursor MCP servers and subagents instead of AI SDK function tools.');
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});
