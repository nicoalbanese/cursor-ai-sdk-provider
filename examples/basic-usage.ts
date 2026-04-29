import { generateText } from 'ai';
import { cursor } from '../src/index';

async function main() {
  const result = await generateText({
    model: cursor('composer-2'),
    prompt:
      'Hi',
  });

  console.log('Response:\n');
  console.log(result.text);

  console.log('\nUsage:');
  console.log(result.usage);

  console.log('\nCursor metadata:');
  console.log(result.providerMetadata?.cursor);
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});
