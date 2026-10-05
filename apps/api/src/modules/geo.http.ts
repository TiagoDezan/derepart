import { geocodeRequestSchema, reverseGeocodeSchema, type PublicConfigDto, MAX_STOPS_PER_ROUTE } from '@derepart/shared';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth';
import type { AppDeps } from '../context';
import { AppError } from '../lib/errors';

export function geoHttp(app: FastifyInstance, deps: AppDeps) {
  const geoLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };

  app.get('/api/config', async (): Promise<PublicConfigDto> => ({
    mapProvider: deps.maps.routingName,
    trafficAware: deps.maps.capabilities.traffic,
    roadPreferences: deps.maps.capabilities.roadPreferences,
    geocoders: deps.maps.geocoderNames,
    aiProvider: deps.ai.name,
    maxStops: MAX_STOPS_PER_ROUTE,
  }));

  app.post('/api/geocode', { config: geoLimit }, async (req) => {
    requireAuth(req);
    const input = geocodeRequestSchema.parse(req.body);
    if (!input.street && !input.query) throw new AppError('VALIDATION', { fields: { street: 'Informe a rua ou um endereço' } });
    return deps.maps.geocode(input);
  });

  app.get('/api/geocode/reverse', { config: geoLimit }, async (req) => {
    requireAuth(req);
    const { lat, lng } = reverseGeocodeSchema.parse(req.query);
    return { candidate: await deps.maps.reverseGeocode(lat, lng) };
  });
}
