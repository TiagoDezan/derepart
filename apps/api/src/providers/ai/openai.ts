import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { fetchJson, ProviderHttpError } from '../../lib/http';
import { aiLabelSchema, LABEL_SYSTEM_PROMPT, toAiResult } from './labelSchema';
import type { AiLabelResult, AiProvider } from './types';

interface ChatCompletion {
  choices: { message: { content: string | null; refusal?: string | null } }[];
}

/**
 * OpenAI-compatible Chat Completions endpoint (OpenAI or any compatible gateway).
 * Configure in apps/api/.env: AI_PROVIDER=openai, OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly supportsImages = true;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  interpretText(ocrText: string): Promise<AiLabelResult> {
    return this.run([{ type: 'text', text: `OCR text of the label:\n"""\n${ocrText}\n"""` }]);
  }

  interpretImage(imageBase64: string, mimeType: string, ocrText?: string | null): Promise<AiLabelResult> {
    return this.run([
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
      { type: 'text', text: ocrText ? `OCR text (may contain errors):\n"""\n${ocrText}\n"""` : 'Photo of the label.' },
    ]);
  }

  private async run(content: unknown[]): Promise<AiLabelResult> {
    try {
      const res = await fetchJson<ChatCompletion>(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        provider: 'openai',
        timeoutMs: this.timeoutMs,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: {
          model: this.model,
          messages: [
            { role: 'system', content: LABEL_SYSTEM_PROMPT },
            { role: 'user', content },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'label', strict: true, schema: z.toJSONSchema(aiLabelSchema) },
          },
        },
      });
      const text = res.choices[0]?.message.content;
      if (!text) throw new AppError('AI_FAILED', undefined, { cause: res.choices[0]?.message.refusal ?? 'empty' });
      return toAiResult(aiLabelSchema.parse(JSON.parse(text)));
    } catch (err) {
      if (err instanceof AppError) {
        if (err.code === 'PROVIDER_NOT_CONFIGURED') throw new AppError('AI_NOT_CONFIGURED', undefined, { cause: err.cause });
        if (err.code === 'PROVIDER_QUOTA') throw new AppError('RATE_LIMITED', undefined, { cause: err.cause });
        if (err.code === 'PROVIDER_UNAVAILABLE') throw new AppError('AI_FAILED', undefined, { cause: err.cause });
        throw err;
      }
      if (err instanceof ProviderHttpError) throw new AppError('AI_FAILED', undefined, { cause: JSON.stringify(err.body).slice(0, 300) });
      throw new AppError('AI_FAILED', undefined, { cause: err });
    }
  }
}
