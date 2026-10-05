import { AppError } from '../../lib/errors';
import { fetchJson, ProviderHttpError } from '../../lib/http';
import { aiLabelSchema, LABEL_SYSTEM_PROMPT, toAiResult } from './labelSchema';
import type { AiLabelResult, AiProvider } from './types';

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

const nullableString = { type: ['string', 'null'] };

/** Same contract as aiLabelSchema, written in the JSON Schema subset Gemini accepts. */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    recipientName: nullableString,
    phone: nullableString,
    street: nullableString,
    number: nullableString,
    complement: nullableString,
    postalCode: nullableString,
    city: nullableString,
    province: nullableString,
    country: { type: 'string' },
    notes: nullableString,
    confidence: { type: 'number' },
  },
  required: ['recipientName', 'phone', 'street', 'number', 'complement', 'postalCode', 'city', 'province', 'country', 'notes', 'confidence'],
};

/**
 * Google Gemini (generateContent, structured JSON output). Configure in apps/api/.env:
 *   AI_PROVIDER=gemini
 *   GEMINI_API_KEY=...            (Google AI Studio)
 *   GEMINI_MODEL=gemini-3.8-flash (optional)
 */
export class GeminiAiProvider implements AiProvider {
  readonly name = 'gemini';
  readonly supportsImages = true;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  interpretText(ocrText: string): Promise<AiLabelResult> {
    return this.run([{ text: `OCR text of the label:\n"""\n${ocrText}\n"""` }]);
  }

  interpretImage(imageBase64: string, mimeType: string, ocrText?: string | null): Promise<AiLabelResult> {
    return this.run([
      { inline_data: { mime_type: mimeType, data: imageBase64 } },
      { text: ocrText ? `Photo of the label above. OCR text (may contain errors):\n"""\n${ocrText}\n"""` : 'Photo of the label above.' },
    ]);
  }

  private async run(parts: unknown[]): Promise<AiLabelResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(this.model)}:generateContent`;
    try {
      const res = await fetchJson<GenerateContentResponse>(url, {
        method: 'POST',
        provider: 'gemini',
        timeoutMs: this.timeoutMs,
        headers: { 'x-goog-api-key': this.apiKey },
        body: {
          system_instruction: { parts: [{ text: LABEL_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: RESPONSE_SCHEMA },
        },
      });
      if (res.promptFeedback?.blockReason) {
        throw new AppError('AI_FAILED', undefined, { cause: `blocked: ${res.promptFeedback.blockReason}` });
      }
      const candidate = res.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!text) throw new AppError('AI_FAILED', undefined, { cause: `empty response (finishReason=${candidate?.finishReason})` });
      return toAiResult(aiLabelSchema.parse(JSON.parse(text)));
    } catch (err) {
      if (err instanceof AppError) {
        if (err.code === 'PROVIDER_NOT_CONFIGURED') throw new AppError('AI_NOT_CONFIGURED', undefined, { cause: err.cause });
        if (err.code === 'PROVIDER_QUOTA') throw new AppError('RATE_LIMITED', undefined, { cause: err.cause });
        if (err.code === 'PROVIDER_UNAVAILABLE') throw new AppError('AI_FAILED', undefined, { cause: err.cause });
        throw err;
      }
      if (err instanceof ProviderHttpError) {
        const message = (err.body as { error?: { message?: string } })?.error?.message ?? '';
        // An invalid key comes back as 400 INVALID_ARGUMENT "API key not valid"
        if (/api key/i.test(message)) throw new AppError('AI_NOT_CONFIGURED', undefined, { cause: message });
        throw new AppError('AI_FAILED', undefined, { cause: `${err.status} ${message}`.slice(0, 300) });
      }
      throw new AppError('AI_FAILED', undefined, { cause: err });
    }
  }
}
