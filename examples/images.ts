import { readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { generateText } from 'ai';
import { cursor } from '../src/index';

const supportedExtensions: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

async function main() {
  const inputPath = process.argv[2];

  if (inputPath === undefined) {
    throw new Error('Usage: bun examples/images.ts /absolute/path/to/image.png');
  }

  const filePath = resolve(inputPath);
  const extension = extname(filePath).toLowerCase();
  const mediaType = supportedExtensions[extension];

  if (mediaType === undefined) {
    throw new Error(
      `Unsupported image extension "${extension}". Supported extensions: ${Object.keys(
        supportedExtensions,
      ).join(', ')}`,
    );
  }

  const image = readFileSync(filePath).toString('base64');
  const result = await generateText({
    model: cursor('composer-2'),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Describe ${basename(filePath)} in one concise paragraph.`,
          },
          {
            type: 'image',
            image,
            mediaType,
          },
        ],
      },
    ],
  });

  console.log(result.text);
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});
