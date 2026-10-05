import { decodePolyline, encodePolyline, type LatLng, type VehicleType } from '@derepart/shared';
import { AppError } from '../../../lib/errors';
import { fetchJson, ProviderHttpError } from '../../../lib/http';
import type { Matrix, ProviderCapabilities, RouteResult, RoutingOptions, RoutingProvider } from '../types';
import { computeComplexity, mergeComplexity, type StepInfo } from './complexity';

interface MatrixElement {
  originIndex: number;
  destinationIndex: number;
  duration?: string;
  distanceMeters?: number;
  condition?: 'ROUTE_EXISTS' | 'ROUTE_NOT_FOUND';
  status?: { code?: number; message?: string };
}
interface ComputeRoutesResponse {
  routes?: {
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline: string };
    legs?: {
      distanceMeters?: number;
      duration?: string;
      steps?: { navigationInstruction?: { maneuver?: string; instructions?: string } }[];
    }[];
  }[];
}

const seconds = (d: string | undefined) => (d ? Number(d.replace('s', '')) : 0);
const NON_MANEUVERS = new Set(['DEPART', 'STRAIGHT', 'NAME_CHANGE', 'MANEUVER_UNSPECIFIED']);
const MAX_INTERMEDIATES = 25;

function travelMode(v: VehicleType) {
  if (v === 'bicycle') return 'BICYCLE';
  if (v === 'motorbike') return 'TWO_WHEELER';
  return 'DRIVE';
}

const waypoint = (p: LatLng) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
const location = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

/**
 * Google Routes API (computeRouteMatrix + computeRoutes). Configure GOOGLE_MAPS_API_KEY in
 * apps/api/.env and enable "Routes API" in the Google Cloud project. Billed per matrix element.
 */
export class GoogleRouting implements RoutingProvider {
  readonly name = 'google';
  readonly capabilities: ProviderCapabilities;

  constructor(
    private readonly apiKey: string,
    private readonly trafficAware: boolean,
    private readonly timeoutMs: number,
  ) {
    // 625 elements per request → 25×25 blocks (the facade chunks bigger matrices).
    this.capabilities = { traffic: trafficAware, roadPreferences: false, maxMatrixLocations: 25, maxRouteWaypoints: 1000 };
  }

  private routingPreference(opts: RoutingOptions) {
    if (opts.vehicle === 'bicycle') return {};
    return { routingPreference: this.trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE' };
  }

  async calculateMatrix(points: LatLng[], opts: RoutingOptions): Promise<Matrix> {
    const elements = await this.call<MatrixElement[]>(
      'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      'originIndex,destinationIndex,duration,distanceMeters,condition,status',
      {
        origins: points.map(waypoint),
        destinations: points.map(waypoint),
        travelMode: travelMode(opts.vehicle),
        ...this.routingPreference(opts),
        ...(opts.departureAt && opts.departureAt.getTime() > Date.now() ? { departureTime: opts.departureAt.toISOString() } : {}),
      },
    );
    const n = points.length;
    const durations: (number | null)[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : null)));
    const distances: (number | null)[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : null)));
    for (const e of elements) {
      if (e.originIndex === e.destinationIndex) continue;
      if (e.condition !== 'ROUTE_EXISTS') continue;
      durations[e.originIndex][e.destinationIndex] = seconds(e.duration);
      distances[e.originIndex][e.destinationIndex] = e.distanceMeters ?? 0;
    }
    return { durations, distances, trafficAware: this.trafficAware && opts.vehicle !== 'bicycle' };
  }

  async calculateRoute(points: LatLng[], opts: RoutingOptions): Promise<RouteResult> {
    // computeRoutes accepts up to 25 intermediates; longer routes are split in chunks.
    const chunks: LatLng[][] = [];
    for (let i = 0; i < points.length - 1; i += MAX_INTERMEDIATES + 1) {
      chunks.push(points.slice(i, Math.min(points.length, i + MAX_INTERMEDIATES + 2)));
    }
    const parts = await Promise.all(chunks.map((c) => this.routeChunk(c, opts)));
    const shape: [number, number][] = [];
    for (const p of parts) {
      const pts = decodePolyline(p.geometry);
      shape.push(...(shape.length ? pts.slice(1) : pts));
    }
    const distanceM = parts.reduce((s, p) => s + p.distanceM, 0);
    return {
      distanceM,
      durationS: parts.reduce((s, p) => s + p.durationS, 0),
      geometry: encodePolyline(shape),
      legs: parts.flatMap((p) => p.legs),
      complexity: mergeComplexity(
        parts.map((p) => p.complexity),
        distanceM,
      ),
      trafficAware: parts.every((p) => p.trafficAware),
    };
  }

  private async routeChunk(points: LatLng[], opts: RoutingOptions): Promise<RouteResult> {
    const res = await this.call<ComputeRoutesResponse>(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.steps.navigationInstruction',
      {
        origin: location(points[0]),
        destination: location(points[points.length - 1]),
        intermediates: points.slice(1, -1).map(location),
        travelMode: travelMode(opts.vehicle),
        ...this.routingPreference(opts),
        languageCode: 'es-ES',
        units: 'METRIC',
      },
    );
    const route = res.routes?.[0];
    if (!route) throw new AppError('ROUTE_IMPOSSIBLE');
    const steps: StepInfo[] = (route.legs ?? []).flatMap((l) =>
      (l.steps ?? []).map((s) => ({
        isManeuver: !NON_MANEUVERS.has(s.navigationInstruction?.maneuver ?? 'MANEUVER_UNSPECIFIED'),
        road: null,
      })),
    );
    const distanceM = route.distanceMeters ?? 0;
    return {
      distanceM,
      durationS: seconds(route.duration),
      geometry: route.polyline?.encodedPolyline ?? '',
      legs: (route.legs ?? []).map((l) => ({ distanceM: l.distanceMeters ?? 0, durationS: seconds(l.duration) })),
      complexity: computeComplexity(steps, distanceM),
      trafficAware: this.trafficAware && opts.vehicle !== 'bicycle',
    };
  }

  private async call<T>(url: string, fieldMask: string, body: unknown): Promise<T> {
    try {
      return await fetchJson<T>(url, {
        method: 'POST',
        body,
        provider: this.name,
        timeoutMs: this.timeoutMs,
        headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': fieldMask },
      });
    } catch (err) {
      if (err instanceof ProviderHttpError) {
        const status = (err.body as { error?: { status?: string; message?: string } })?.error;
        if (status?.status === 'RESOURCE_EXHAUSTED') throw new AppError('PROVIDER_QUOTA', undefined, { cause: status.message });
        if (status?.status === 'INVALID_ARGUMENT') throw new AppError('ROUTE_TOO_LARGE', undefined, { cause: status.message });
        throw new AppError('PROVIDER_UNAVAILABLE', undefined, { cause: status?.message });
      }
      throw err;
    }
  }
}
