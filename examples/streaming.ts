import { streamText } from 'ai';
import { cursor } from '../src/index';

async function main() {
  const startTime = Date.now();
  const result = streamText({
    model: cursor('composer-2'),
    prompt:
      'Write a short explanation of how you would triage a failing CI job in a TypeScript repository.',
  });

  let chunkCount = 0;
  let totalCharacters = 0;
  let firstChunkAt: number | undefined;

  console.log('Response:\n');

  for await (const chunk of result.textStream) {
    if (firstChunkAt === undefined) {
      firstChunkAt = Date.now();
    }

    process.stdout.write(chunk);
    chunkCount += 1;
    totalCharacters += chunk.length;
  }

  const usage = await result.usage;
  const providerMetadata = await result.providerMetadata;
  const finishedAt = Date.now();

  console.log('\n\nStats:');
  console.log(`Chunks: ${chunkCount}`);
  console.log(`Characters: ${totalCharacters}`);
  console.log(
    `Time to first chunk: ${firstChunkAt === undefined ? 0 : firstChunkAt - startTime}ms`,
  );
  console.log(`Total time: ${finishedAt - startTime}ms`);
  console.log('Usage:', usage);
  console.log('Cursor metadata:', providerMetadata?.cursor);
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});
