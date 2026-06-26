import { streamText } from 'ai';
import { createCursor } from '../src/index';

async function main() {
  const repoUrl = process.env.CURSOR_EXAMPLE_REPO_URL;

  if (repoUrl === undefined || repoUrl.length === 0) {
    throw new Error(
      'Set CURSOR_EXAMPLE_REPO_URL to a repository URL connected to Cursor before running this example.',
    );
  }

  const provider = createCursor({
    cloud: {
      repos: [
        {
          url: repoUrl,
          startingRef: process.env.CURSOR_EXAMPLE_STARTING_REF ?? 'main',
        },
      ],
      autoCreatePR: process.env.CURSOR_EXAMPLE_AUTO_PR === '1',
    },
  });

  const result = streamText({
    model: provider('composer-2'),
    prompt:
      'Summarize the repository structure and identify the most likely test command. Do not edit files.',
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
