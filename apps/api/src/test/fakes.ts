import { encodePolyline, haversineM, nameSimilarity, type LatLng } from '@derepart/shared';
import { loadConfig } from '../config';
import type { AppDeps } from '../context';
import { openDatabase } from '../db/client';
import { FieldCipher } from '../lib/crypto';
import { NoAiProvider } from '../providers/ai/none';
import type { AiProvider } from '../providers/ai/types';
import { CompositeMapProvider } from '../providers/maps/mapProvider';
import type { AddressQuery, GeocodingProvider, Matrix, RawCandidate, RouteResult, RoutingProvider } from '../providers/maps/types';

/** Deterministic routing engine for tests: road distance = 1.3 × great-circle, 40 km/h. */
export class FakeRouting implements RoutingProvider {
  readonly name = 'fake';
  readonly capabilities = { traffic: false, roadPreferences: false, maxMatrixLocations: 100, maxRouteWaypoints: 200 };
  matrixCalls = 0;

  async calculateMatrix(points: LatLng[]): Promise<Matrix> {
    this.matrixCalls++;
    const distances = points.map((a) => points.map((b) => haversineM(a, b) * 1.3));
    return { distances, durations: distances.map((r) => r.map((d) => d / 11.1)), trafficAware: false };
  }

  async calculateRoute(points: LatLng[]): Promise<RouteResult> {
    const legs = points.slice(1).map((p, i) => {
      const d = haversineM(points[i], p) * 1.3;
      return { distanceM: d, durationS: d / 11.1 };
    });
    const distanceM = legs.reduce((s, l) => s + l.distanceM, 0);
    return {
      distanceM,
      durationS: legs.reduce((s, l) => s + l.durationS, 0),
      geometry: encodePolyline(points.map((p) => [p.lat, p.lng])),
      legs,
      complexity: { maneuvers: legs.length * 4, roadChanges: legs.length * 2, maneuversPerKm: 1 },
      trafficAware: false,
    };
  }
}

/** Geocoder backed by a small fixture table of real Málaga-area addresses. */
export class FakeGeocoder implements GeocodingProvider {
  readonly name = 'fake-geo';
  constructor(private readonly table: RawCandidate[]) {}

  async geocode(q: AddressQuery): Promise<RawCandidate[]> {
    // fuzzy like CartoCiudad: tolerates OCR typos (\"San Migel\")
    return this.table.filter((c) => nameSimilarity(q.street ?? q.query, c.street, true) > 0.7);
  }

  async reverseGeocode(p: LatLng): Promise<RawCandidate | null> {
    return [...this.table].sort((a, b) => haversineM(p, a) - haversineM(p, b))[0] ?? null;
  }
}

export const FIXTURE_ADDRESSES: RawCandidate[] = [
  { street: 'Calle San Miguel', number: '15', postalCode: '29620', city: 'Torremolinos', province: 'Málaga', lat: 36.62371, lng: -4.49916 },
  { street: 'Avenida de Andalucía', number: '12', postalCode: '29007', city: 'Málaga', province: 'Málaga', lat: 36.71727, lng: -4.43087 },
  { street: 'Calle Marqués de Larios', number: '5', postalCode: '29005', city: 'Málaga', province: 'Málaga', lat: 36.71909, lng: -4.42146 },
  { street: 'Avenida de la Constitución', number: '2', postalCode: '29640', city: 'Fuengirola', province: 'Málaga', lat: 36.54079, lng: -4.62464 },
  { street: 'Calle Real', number: '40', postalCode: '29130', city: 'Alhaurín de la Torre', province: 'Málaga', lat: 36.66339, lng: -4.56119 },
  { street: 'Avenida Antonio Machado', number: '30', postalCode: '29630', city: 'Benalmádena', province: 'Málaga', lat: 36.59858, lng: -4.51571 },
  { street: 'Calle Maestra Ascensión Rodríguez', number: '6', postalCode: '29140', city: 'Málaga', province: 'Málaga', lat: 36.66639, lng: -4.50431 },
].map((c) => ({
  ...c,
  country: 'ES',
  provinceCode: '29',
  precision: 'rooftop' as const,
  provider: 'fake-geo',
  formattedAddress: `${c.street}, ${c.number}, ${c.postalCode} ${c.city}`,
}));

export async function testDeps(overrides: { ai?: AiProvider } = {}): Promise<AppDeps & { routing: FakeRouting; close: () => Promise<void> }> {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', OPTIMIZER_TIME_LIMIT_MS: '300' });
  const handle = await openDatabase({ pgliteDir: 'memory' });
  const routing = new FakeRouting();
  const maps = new CompositeMapProvider([new FakeGeocoder(FIXTURE_ADDRESSES)], routing, 300, { warn: () => {} });
  return {
    config,
    db: handle.db,
    cipher: new FieldCipher(Buffer.alloc(32, 7).toString('base64')),
    maps,
    ai: overrides.ai ?? new NoAiProvider(),
    routing,
    close: handle.close,
  };
}
