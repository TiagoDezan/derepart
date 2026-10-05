import type { AppConfig } from '../../config';
import { AnthropicAiProvider } from './anthropic';
import { NoAiProvider } from './none';
import { OpenAiProvider } from './openai';
import type { AiProvider } from './types';

const AI_TIMEOUT_MS = 45_000;

/** AI_PROVIDER=none | anthropic | openai (keys only in apps/api/.env, never in the web app). */
export function createAiProvider(config: AppConfig, log?: { warn: (m: string) => void }): AiProvider {
  switch (config.AI_PROVIDER) {
    case 'anthropic':
      if (!config.ANTHROPIC_API_KEY) {
        log?.warn('AI_PROVIDER=anthropic, mas ANTHROPIC_API_KEY está vazio — IA desativada');
        return new NoAiProvider();
      }
      return new AnthropicAiProvider(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL, AI_TIMEOUT_MS);
    case 'openai':
      if (!config.OPENAI_API_KEY) {
        log?.warn('AI_PROVIDER=openai, mas OPENAI_API_KEY está vazio — IA desativada');
        return new NoAiProvider();
      }
      return new OpenAiProvider(config.OPENAI_API_KEY, config.OPENAI_MODEL, config.OPENAI_BASE_URL, AI_TIMEOUT_MS);
    default:
      return new NoAiProvider();
  }
}

export type { AiProvider } from './types';
