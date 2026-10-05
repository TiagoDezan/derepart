import type { ParsedLabel } from '@derepart/shared';

export interface AiLabelResult {
  fields: ParsedLabel;
  /** Model's self-reported confidence 0–1 (used only as one signal among others). */
  confidence: number;
}

/**
 * AI used to interpret shipping labels when the rule-based parser is not confident.
 * Implementations: anthropic, openai, none (AI_PROVIDER in apps/api/.env).
 */
export interface AiProvider {
  /** null when AI is disabled. */
  readonly name: string | null;
  readonly supportsImages: boolean;
  interpretText(ocrText: string): Promise<AiLabelResult>;
  interpretImage(imageBase64: string, mimeType: string, ocrText?: string | null): Promise<AiLabelResult>;
}
