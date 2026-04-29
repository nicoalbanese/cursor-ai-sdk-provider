import { Buffer } from 'node:buffer';
import type {
  JSONValue,
  LanguageModelV3CallOptions,
  LanguageModelV3FilePart,
  LanguageModelV3Prompt,
  LanguageModelV3ToolResultOutput,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { SDKImage, SDKUserMessage } from '@cursor/sdk';

export interface CursorMessageConversion {
  message: string | SDKUserMessage;
  warnings: SharedV3Warning[];
}

export function convertToCursorMessage(
  options: LanguageModelV3CallOptions,
): CursorMessageConversion {
  const warnings: SharedV3Warning[] = [];
  const images: SDKImage[] = [];
  const useTranscript = shouldUseTranscript(options.prompt);
  const text = renderPrompt(options.prompt, images, warnings, useTranscript);
  const responseFormatInstruction = renderResponseFormatInstruction(options);

  if (responseFormatInstruction !== undefined) {
    warnings.push({
      type: 'compatibility',
      feature: 'responseFormat',
      details:
        'Cursor SDK does not expose a native JSON response format through the agent API, so this provider adds a text instruction.',
    });
  }

  const finalText = [text, responseFormatInstruction]
    .filter((value) => value !== undefined && value.length > 0)
    .join('\n\n');

  if (images.length > 0) {
    return {
      message: {
        text: finalText,
        images,
      },
      warnings,
    };
  }

  return { message: finalText, warnings };
}

function shouldUseTranscript(prompt: LanguageModelV3Prompt): boolean {
  if (prompt.length !== 1) {
    return true;
  }

  const [message] = prompt;
  return message === undefined || message.role !== 'user';
}

function renderPrompt(
  prompt: LanguageModelV3Prompt,
  images: SDKImage[],
  warnings: SharedV3Warning[],
  useTranscript: boolean,
): string {
  const sections: string[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case 'system': {
        sections.push(renderSection('System', message.content, useTranscript));
        break;
      }
      case 'user': {
        const textParts: string[] = [];
        for (const part of message.content) {
          switch (part.type) {
            case 'text': {
              textParts.push(part.text);
              break;
            }
            case 'file': {
              const image = toCursorImage(part, warnings);
              if (image !== undefined) {
                images.push(image);
                textParts.push(`[Image attached: ${part.mediaType}]`);
              }
              break;
            }
          }
        }
        sections.push(renderSection('User', textParts.join('\n'), useTranscript));
        break;
      }
      case 'assistant': {
        const textParts: string[] = [];
        for (const part of message.content) {
          switch (part.type) {
            case 'text': {
              textParts.push(part.text);
              break;
            }
            case 'reasoning': {
              textParts.push(`[Reasoning]\n${part.text}`);
              break;
            }
            case 'file': {
              warnings.push({
                type: 'unsupported',
                feature: 'assistant file prompt parts',
                details:
                  'Cursor SDK agent messages only accept text and user image attachments.',
              });
              break;
            }
            case 'tool-call': {
              textParts.push(
                `[Assistant tool call: ${part.toolName}]\n${formatUnknown(
                  part.input,
                )}`,
              );
              break;
            }
            case 'tool-result': {
              textParts.push(
                `[Assistant tool result: ${part.toolName}]\n${formatToolResultOutput(
                  part.output,
                )}`,
              );
              break;
            }
          }
        }
        sections.push(
          renderSection('Assistant', textParts.join('\n'), useTranscript),
        );
        break;
      }
      case 'tool': {
        const textParts: string[] = [];
        for (const part of message.content) {
          switch (part.type) {
            case 'tool-result': {
              textParts.push(
                `[Tool result: ${part.toolName}]\n${formatToolResultOutput(
                  part.output,
                )}`,
              );
              break;
            }
            case 'tool-approval-response': {
              textParts.push(
                `[Tool approval ${part.approved ? 'granted' : 'denied'}: ${
                  part.approvalId
                }]${part.reason === undefined ? '' : `\n${part.reason}`}`,
              );
              break;
            }
          }
        }
        sections.push(renderSection('Tool', textParts.join('\n'), useTranscript));
        break;
      }
    }
  }

  return sections.filter((section) => section.length > 0).join('\n\n');
}

function renderSection(
  role: string,
  content: string,
  useTranscript: boolean,
): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return '';
  }

  return useTranscript ? `${role}:\n${trimmed}` : trimmed;
}

function toCursorImage(
  part: LanguageModelV3FilePart,
  warnings: SharedV3Warning[],
): SDKImage | undefined {
  if (!part.mediaType.startsWith('image/')) {
    warnings.push({
      type: 'unsupported',
      feature: 'non-image file prompt parts',
      details:
        'Cursor SDK agent messages accept image attachments, but not arbitrary file attachments.',
    });
    return undefined;
  }

  if (part.data instanceof URL) {
    return { url: part.data.toString() };
  }

  if (typeof part.data === 'string') {
    const parsed = parseDataUri(part.data);
    if (parsed !== undefined) {
      return parsed;
    }

    return {
      data: part.data,
      mimeType: part.mediaType,
    };
  }

  return {
    data: Buffer.from(part.data).toString('base64'),
    mimeType: part.mediaType,
  };
}

function parseDataUri(value: string): SDKImage | undefined {
  if (!value.startsWith('data:')) {
    return undefined;
  }

  const commaIndex = value.indexOf(',');
  if (commaIndex === -1) {
    return undefined;
  }

  const metadata = value.slice('data:'.length, commaIndex);
  const data = value.slice(commaIndex + 1);
  const [mimeType] = metadata.split(';');

  if (mimeType === undefined || mimeType.length === 0) {
    return undefined;
  }

  return { data, mimeType };
}

function renderResponseFormatInstruction(
  options: LanguageModelV3CallOptions,
): string | undefined {
  if (options.responseFormat?.type !== 'json') {
    return undefined;
  }

  const lines = ['Return only valid JSON. Do not wrap it in Markdown.'];

  if (options.responseFormat.schema !== undefined) {
    lines.push('The JSON must conform to this schema:');
    lines.push(JSON.stringify(options.responseFormat.schema));
  }

  return lines.join('\n');
}

function formatToolResultOutput(output: LanguageModelV3ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text': {
      return output.value;
    }
    case 'json':
    case 'error-json': {
      return formatUnknown(output.value);
    }
    case 'execution-denied': {
      return output.reason === undefined
        ? 'Execution denied.'
        : `Execution denied: ${output.reason}`;
    }
    case 'content': {
      return output.value
        .map((part) => {
          switch (part.type) {
            case 'text':
              return part.text;
            case 'file-data':
              return `[File data: ${part.mediaType}]`;
            case 'file-url':
              return `[File URL: ${part.url}]`;
            case 'file-id':
              return `[File ID: ${formatUnknown(part.fileId)}]`;
            case 'image-data':
              return `[Image data: ${part.mediaType}]`;
            case 'image-url':
              return `[Image URL: ${part.url}]`;
            case 'image-file-id':
              return `[Image file ID: ${formatUnknown(part.fileId)}]`;
            case 'custom':
              return '[Custom content]';
          }
        })
        .join('\n');
    }
  }
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

export function toNonNullJsonValue(value: unknown): Exclude<JSONValue, null> {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return formatUnknown(value);
}

export function stringifyUnknown(value: unknown): string {
  return formatUnknown(value);
}
