import { decodePolyline, encodePolyline, type LatLng, type OptimizationMode, type VehicleType } from '@derepart/shared';
import { AppError } from '../../../lib/errors';
import { fetchJson, ProviderHttpError } from '../../../lib/http';
import type { Matrix, ProviderCapabilities, RouteResult, RoutingOptions, RoutingProvider } from '../types';
import { computeComplexity, type StepInfo } from './complexity';

interface ValhallaMatrixResponse {
  sources_to_targets: { from_index: number; to_index: number; time: number | null; distance: number | null }[][];
}
interface ValhallaRouteResponse {
  trip: {
    summary: { length: number; time: number };
    legs: {
      shape: string;
      summary: { length: number; time: number };
      maneuvers: { type: number; street_names?: string[] }[];
    }[];
  };
}

/** Maneuver types that are not decisions: start*, destination*, becomes, continue, stay straight. */
const NON_MANEUVER_TYPES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 22]);

function costing(vehicle: VehicleType): string {
  if (vehicle === 'bicycle') return 'bicycle';
  if (vehicle === 'motorbike') return 'motorcycle';
  return 'auto';
}

/**
 * Road preferences per profile. These are objective road attributes from OSM
 * (surface, highway class), not a claim about what the driver knows.
 */
function costingOptions(vehicle: VehicleType, mode: OptimizationMode): Record<string, unknown> {
  const c = costing(vehicle);
  if (c === 'bicycle') {
    return { bicycle: mode === 'fastest' ? {} : { avoid_bad_surfaces: 0.5 } };
  }
  const base: Record<OptimizationMode, Record<string, unknown>> = {
    fastest: { use_highways: 1 },
    economic: { exclude_unpaved: true },
    balanced: { exclude_unpaved: true, use_tracks: 0, use_living_roads: 0.1, use_highways: 0.8 },
  };
  return { [c]: base[mode] };
}

/** Valhalla over OpenStreetMap: like OSRM, no live traffic, but road preferences per request. */
export class ValhallaRouting implements RoutingProvider {
  readonly name = 'valhalla';
  readonly capabilities: ProviderCapabilities;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    maxMatrixLocations: number,
  ) {
    this.capabilities = { traffic: false, roadPreferences: true, maxMatrixLocations, maxRouteWaypoints: 50 };
  }

  async calculateMatrix(points: LatLng[], opts: RoutingOptions): Promise<Matrix> {
    const locs = points.map((p) => ({ lat: p.lat, lon: p.lng }));
    const res = await this.call<ValhallaMatrixResponse>('/sources_to_targets', {
      sources: locs,
      targets: locs,
      costing: costing(opts.vehicle),
      costing_options: costingOptions(opts.vehicle, opts.mode),
      units: 'kilometers',
    });
    const n = points.length;
    const durations: (number | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null));
    const distances: (number | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null));
    for (const row of res.sources_to_targets) {
      for (const cell of row) {
        durations[cell.from_index][cell.to_index] = cell.time;
        distances[cell.from_index][cell.to_index] = cell.distance == null ? null : cell.distance * 1000;
      }
    }
    return { durations, distances, trafficAware: false };
  }

  async calculateRoute(points: LatLng[], opts: RoutingOptions): Promise<RouteResult> {
    const res = await this.call<ValhallaRouteResponse>('/route', {
      locations: points.map((p) => ({ lat: p.lat, lon: p.lng, type: 'break' })),
      costing: costing(opts.vehicle),
      costing_options: costingOptions(opts.vehicle, opts.mode),
      units: 'kilometers',
      directions_options: { units: 'kilometers', language: 'es-ES' },
    });
    const trip = res.trip;
    const shape: [number, number][] = [];
    const steps: StepInfo[] = [];
    for (const leg of trip.legs) {
      const pts = decodePolyline(leg.shape, 6);
      shape.push(...(shape.length ? pts.slice(1) : pts));
      for (const m of leg.maneuvers) {
        steps.push({ isManeuver: !NON_MANEUVER_TYPES.has(m.type), road: m.street_names?.[0] ?? null });
      }
    }
    const distanceM = trip.summary.length * 1000;
    return {
      distanceM,
      durationS: trip.summary.time,
      geometry: encodePolyline(shape, 5),
      legs: trip.legs.map((l) => ({ distanceM: l.summary.length * 1000, durationS: l.summary.time })),
      complexity: computeComplexity(steps, distanceM),
      trafficAware: false,
    };
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    try {
      return await fetchJson<T>(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        body,
        provider: this.name,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (err instanceof ProviderHttpError) {
        const b = err.body as { error_code?: number; error?: string };
        // 171: no suitable edges near location; 442/443: no path; 154/155: matrix/route too large
        if (b?.error_code && [170, 171, 442, 443].includes(b.error_code)) {
          throw new AppError('ROUTE_IMPOSSIBLE', undefined, { cause: b.error });
        }
        if (b?.error_code && [150, 154, 155, 157, 158].includes(b.error_code)) {
          throw new AppError('ROUTE_TOO_LARGE', undefined, { cause: b.error });
        }
        throw new AppError('PROVIDER_UNAVAILABLE', undefined, { cause: `${err.status} ${b?.error}` });
      }
      throw err;
    }
  }
}
