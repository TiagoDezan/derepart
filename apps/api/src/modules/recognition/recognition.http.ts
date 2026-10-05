import { parseLabelSchema, recognizeImageSchema } from '@derepart/shared';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/auth';
import type { AppDeps } from '../../context';
import { AddressRecognitionService } from './recognition.service';

export function recognitionHttp(app: FastifyInstance, deps: AppDeps) {
  const service = new AddressRecognitionService(deps);
  const limit = { rateLimit: { max: 40, timeWindow: '1 minute' } };

  /** OCR text produced on the device → structured, geocoded address. */
  app.post('/api/recognition/text', { config: limit }, async (req) => {
    requireAuth(req);
    return service.parseText(parseLabelSchema.parse(req.body));
  });

  /** Label photo → AI vision. Only with the user's consent (settings.allowAiImages). */
  app.post('/api/recognition/image', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req) => {
    const ctx = requireAuth(req);
    return service.recognizeImage(ctx, recognizeImageSchema.parse(req.body));
  });
}
