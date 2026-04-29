import { streamText } from 'ai';
import { cursor } from '../src/index';

async function main() {
  const result = streamText({
    model: cursor('composer-2'),
    prompt:
      'Inspect the current repository. Read package.json if useful, then summarize the package in three bullets. Do not edit files.',
  });

  console.log('Full stream with Cursor tool events:\n');

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        process.stdout.write(part.text);
        break;
      case 'reasoning-delta':
        process.stdout.write(part.text);
        break;
      case 'tool-input-start':
        console.log(`\n\nTool input started: ${part.toolName} (${part.id})`);
        break;
      case 'tool-input-delta':
        console.log(`Tool input delta: ${part.delta}`);
        break;
      case 'tool-call':
        console.log(`Tool call: ${part.toolName} (${part.toolCallId})`);
        console.log('Input:', part.input);
        break;
      case 'tool-result':
        console.log(`Tool result: ${part.toolName} (${part.toolCallId})`);
        console.log('Output:', part.output);
        break;
      case 'tool-error':
        console.log(`Tool error: ${part.toolName} (${part.toolCallId})`);
        console.log('Error:', part.error);
        break;
      case 'finish-step':
        console.log('\n\nStep finished:');
        console.log('Finish reason:', part.finishReason);
        console.log('Usage:', part.usage);
        break;
      case 'finish':
        console.log('\nRun finished.');
        break;
    }
  }
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});
