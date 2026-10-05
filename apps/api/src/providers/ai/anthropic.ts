import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { AppError } from '../../lib/errors';
import { aiLabelSchema, LABEL_SYSTEM_PROMPT, toAiResult } from './labelSchema';
import type { AiLabelResult, AiProvider } from './types';

type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Claude (Anthropic API). Configure in apps/api/.env:
 *   AI_PROVIDER=anthropic
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   ANTHROPIC_MODEL=claude-opus-5-5   (optional)
 *
 * Structured outputs guarantee the JSON shape. Server-side fallbacks ("default") re-run the
 * request on a fallback model if the primary model declines.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly supportsImages = true;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    timeoutMs: number,
  ) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });
  }

  interpretText(ocrText: string): Promise<AiLabelResult> {
    return this.run([{ type: 'text', text: `OCR text of the label:\n"""\n${ocrText}\n"""` }]);
  }

  interpretImage(imageBase64: string, mimeType: string, ocrText?: string | null): Promise<AiLabelResult> {
    return this.run([
      { type: 'image', source: { type: 'base64', media_type: mimeType as ImageMime, data: imageBase64 } },
      {
        type: 'text',
        text: ocrText
          ? `Photo of the label above. OCR text (may contain errors):\n"""\n${ocrText}\n"""`
          : 'Photo of the label above.',
      },
    ]);
  }

  private async run(content: Anthropic.Beta.BetaContentBlockParam[]): Promise<AiLabelResult> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 2048,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Simple extraction: low effort keeps latency and cost down.
        output_config: { effort: 'low', format: betaZodOutputFormat(aiLabelSchema) },
        system: LABEL_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      });
      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        throw new AppError('AI_FAILED', undefined, { cause: `stop_reason=${response.stop_reason}` });
      }
      return toAiResult(response.parsed_output);
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AppError('AI_NOT_CONFIGURED', undefined, { cause: err.message });
      }
      if (err instanceof Anthropic.RateLimitError) throw new AppError('RATE_LIMITED', undefined, { cause: err.message });
      if (err instanceof Anthropic.APIError) throw new AppError('AI_FAILED', undefined, { cause: `${err.status} ${err.message}` });
      throw new AppError('AI_FAILED', undefined, { cause: err });
    }
  }
}
