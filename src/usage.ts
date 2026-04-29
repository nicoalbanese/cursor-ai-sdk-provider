import type {
  JSONObject,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
} from '@ai-sdk/provider';

interface CursorUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface UsageTracker {
  record(update: unknown): void;
  toLanguageModelUsage(): LanguageModelV3Usage;
  toProviderMetadata(): SharedV3ProviderMetadata | undefined;
}

export function createUsageTracker(): UsageTracker {
  let usage: CursorUsage | undefined;

  return {
    record(update) {
      const nextUsage = readUsageUpdate(update);
      if (nextUsage !== undefined) {
        usage = nextUsage;
      }
    },

    toLanguageModelUsage() {
      return toLanguageModelUsage(usage);
    },

    toProviderMetadata() {
      if (usage === undefined) {
        return undefined;
      }

      return {
        cursor: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
        },
      };
    },
  };
}

export function createEmptyUsage(): LanguageModelV3Usage {
  return toLanguageModelUsage(undefined);
}

function toLanguageModelUsage(
  usage: CursorUsage | undefined,
): LanguageModelV3Usage {
  const languageModelUsage: LanguageModelV3Usage = {
    inputTokens: {
      total: usage?.inputTokens,
      noCache: usage?.inputTokens,
      cacheRead: usage?.cacheReadTokens,
      cacheWrite: usage?.cacheWriteTokens,
    },
    outputTokens: {
      total: usage?.outputTokens,
      text: usage?.outputTokens,
      reasoning: undefined,
    },
  };

  const raw = toRawUsage(usage);
  if (raw !== undefined) {
    languageModelUsage.raw = raw;
  }

  return languageModelUsage;
}

function toRawUsage(usage: CursorUsage | undefined): JSONObject | undefined {
  if (usage === undefined) {
    return undefined;
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  };
}

function readUsageUpdate(update: unknown): CursorUsage | undefined {
  if (!isRecord(update) || update.type !== 'turn-ended') {
    return undefined;
  }

  const usage = update.usage;
  if (!isRecord(usage)) {
    return undefined;
  }

  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const cacheReadTokens = usage.cacheReadTokens;
  const cacheWriteTokens = usage.cacheWriteTokens;

  if (
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number' ||
    typeof cacheReadTokens !== 'number' ||
    typeof cacheWriteTokens !== 'number'
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
