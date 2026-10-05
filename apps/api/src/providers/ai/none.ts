import { AppError } from '../../lib/errors';
import type { AiProvider } from './types';

/** AI_PROVIDER=none: the app works with OCR + rule-based parsing only. */
export class NoAiProvider implements AiProvider {
  readonly name = null;
  readonly supportsImages = false;

  async interpretText(): Promise<never> {
    throw new AppError('AI_NOT_CONFIGURED');
  }

  async interpretImage(): Promise<never> {
    throw new AppError('AI_NOT_CONFIGURED');
  }
}
