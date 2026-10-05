import type { GeocodeResponse, ParsedLabel, RecognitionResult } from '@derepart/shared';
import { eq } from 'drizzle-orm';
import type { AppDeps, AuthContext } from '../../context';
import { userSettings } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { parseLabel } from './labelParser';

const LOW_CONFIDENCE_MESSAGE = 'Verifique este endereço. Algumas informações podem não ter sido identificadas corretamente.';
/** Below this, the rule-based result is not trusted and AI is consulted (text only). */
const AI_THRESHOLD = 0.7;
const GEOCODE_FACTOR: Record<GeocodeResponse['status'], number> = { ok: 1, needs_review: 0.8, ambiguous: 0.6, not_found: 0.3 };

/**
 * AddressRecognitionService — pipeline:
 *   OCR text (done on the device) → rule-based parse → [AI on text if needed]
 *   → geocoding + cross-validation → result for user confirmation.
 * Images are sent to AI only through `recognizeImage`, after explicit user consent,
 * and are never stored.
 */
export class AddressRecognitionService {
  constructor(private readonly deps: AppDeps) {}

  async parseText(input: { text: string; ocrConfidence: number | null; allowAi: boolean }): Promise<RecognitionResult> {
    const text = input.text.trim();
    if (text.length < 5) throw new AppError('OCR_FAILED');
    const parsed = parseLabel(text);
    const ocrFactor = input.ocrConfidence != null ? input.ocrConfidence / 100 : 0.7;
    let confidence = 0.75 * parsed.confidence + 0.25 * ocrFactor;
    let fields: ParsedLabel = parsed.fields;
    let usedAi = false;
    const warnings: string[] = [];

    const incomplete = !fields.street || (!fields.postalCode && !fields.city);
    const needsAi = confidence < AI_THRESHOLD || incomplete;
    const ai = this.deps.ai;
    if (needsAi && input.allowAi && ai.name) {
      try {
        const res = await ai.interpretText(text);
        fields = mergeFields(fields, res.fields);
        usedAi = true;
        confidence = Math.max(confidence, 0.5 * res.confidence + 0.5 * completeness(fields));
      } catch (err) {
        warnings.push('A interpretação por IA falhou; confira os dados manualmente.');
        if (!(err instanceof AppError)) throw err;
      }
    }
    return this.finish(fields, confidence, { usedAi, aiSuggested: needsAi && !usedAi && !!ai.name, warnings });
  }

  async recognizeImage(ctx: AuthContext, input: { imageBase64: string; mimeType: string; ocrText?: string | null }): Promise<RecognitionResult> {
    const [s] = await this.deps.db.select().from(userSettings).where(eq(userSettings.userId, ctx.userId));
    if (!s?.allowAiImages) throw new AppError('AI_IMAGES_DISABLED');
    if (!this.deps.ai.name || !this.deps.ai.supportsImages) throw new AppError('AI_NOT_CONFIGURED');
    // The image lives only in this request's memory.
    const res = await this.deps.ai.interpretImage(input.imageBase64, input.mimeType, input.ocrText ?? null);
    const confidence = 0.5 * res.confidence + 0.5 * completeness(res.fields);
    return this.finish(res.fields, confidence, { usedAi: true, aiSuggested: false, warnings: [] });
  }

  private async finish(
    fields: ParsedLabel,
    baseConfidence: number,
    extra: { usedAi: boolean; aiSuggested: boolean; warnings: string[] },
  ): Promise<RecognitionResult> {
    let geocode: GeocodeResponse | null = null;
    const warnings = [...extra.warnings];
    if (fields.street) {
      try {
        geocode = await this.deps.maps.geocode({
          street: fields.street,
          number: fields.number,
          postalCode: fields.postalCode,
          city: fields.city,
          province: fields.province,
          country: fields.country,
        });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        warnings.push('Não foi possível localizar o endereço agora. Você pode confirmar no mapa.');
      }
    }
    const confidence = Math.round(baseConfidence * (geocode ? GEOCODE_FACTOR[geocode.status] : 0.5) * 100) / 100;
    if (confidence < 0.75) warnings.unshift(LOW_CONFIDENCE_MESSAGE);
    return {
      fields,
      confidence,
      usedAi: extra.usedAi,
      aiProvider: extra.usedAi ? this.deps.ai.name : null,
      aiSuggested: extra.aiSuggested,
      geocode,
      warnings,
    };
  }
}

function completeness(f: ParsedLabel): number {
  return (f.street ? 0.35 : 0) + (f.number ? 0.15 : 0) + (f.postalCode ? 0.3 : 0) + (f.city ? 0.2 : 0);
}

/** AI fields win; rule-based values fill what the AI left empty. */
function mergeFields(rule: ParsedLabel, ai: ParsedLabel): ParsedLabel {
  const out = { ...rule };
  for (const k of Object.keys(ai) as (keyof ParsedLabel)[]) {
    if (ai[k] != null && ai[k] !== '') (out as Record<string, unknown>)[k] = ai[k];
  }
  return out;
}
