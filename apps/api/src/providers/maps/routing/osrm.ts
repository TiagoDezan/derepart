import type { LatLng } from '@derepart/shared';
import { AppError } from '../../../lib/errors';
import { fetchJson, ProviderHttpError } from '../../../lib/http';
import type { Matrix, ProviderCapabilities, RouteResult, RoutingOptions, RoutingProvider } from '../types';
import { computeComplexity, type StepInfo } from './complexity';

interface OsrmStep {
  name: string;
  ref?: string;
  maneuver: { type: string; modifier?: string };
}
interface OsrmRouteResponse {
  code: string;
  message?: string;
  routes: {
    distance: number;
    duration: number;
    geometry: string;
    legs: { distance: number; duration: number; steps: OsrmStep[] }[];
  }[];
}
interface OsrmTableResponse {
  code: string;
  message?: string;
  durations: (number | null)[][];
  distances: (number | null)[][];
}

const NON_MANEUVERS = new Set(['depart', 'arrive', 'new name', 'notification', 'use lane']);

/**
 * OSRM (Open Source Routing Machine) over OpenStreetMap. No live traffic: speeds come from
 * road classes. Point OSRM_URL at a self-hosted instance with the Spain extract for production;
 * the public demo is for development only.
 */
export class OsrmRouting implements RoutingProvider {
  readonly name = 'osrm';
  readonly capabilities: ProviderCapabilities;

  constructor(
    private readonly carUrl: string,
    private readonly bikeUrl: string,
    private readonly timeoutMs: number,
    maxTableSize: number,
  ) {
    this.capabilities = { traffic: false, roadPreferences: false, maxMatrixLocations: maxTableSize, maxRouteWaypoints: 200 };
  }

  private base(opts: RoutingOptions) {
    return `${opts.vehicle === 'bicycle' ? this.bikeUrl : this.carUrl}`.replace(/\/$/, '');
  }

  private coords(points: LatLng[]) {
    return points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  }

  async calculateMatrix(points: LatLng[], opts: RoutingOptions): Promise<Matrix> {
    const url = `${this.base(opts)}/table/v1/driving/${this.coords(points)}?annotations=duration,distance`;
    const res = await this.call<OsrmTableResponse>(url);
    return { durations: res.durations, distances: res.distances, trafficAware: false };
  }

  async calculateRoute(points: LatLng[], opts: RoutingOptions): Promise<RouteResult> {
    const url = `${this.base(opts)}/route/v1/driving/${this.coords(points)}?overview=full&geometries=polyline&steps=true`;
    const res = await this.call<OsrmRouteResponse>(url);
    const route = res.routes[0];
    if (!route) throw new AppError('ROUTE_IMPOSSIBLE');
    const steps: StepInfo[] = route.legs.flatMap((leg) =>
      leg.steps.map((s) => ({
        isManeuver: !NON_MANEUVERS.has(s.maneuver.type) && !(s.maneuver.type === 'continue' && s.maneuver.modifier === 'straight'),
        road: s.ref || s.name || null,
      })),
    );
    return {
      distanceM: route.distance,
      durationS: route.duration,
      geometry: route.geometry,
      legs: route.legs.map((l) => ({ distanceM: l.distance, durationS: l.duration })),
      complexity: computeComplexity(steps, route.distance),
      trafficAware: false,
    };
  }

  private async call<T extends { code: string; message?: string }>(url: string): Promise<T> {
    try {
      const res = await fetchJson<T>(url, { provider: this.name, timeoutMs: this.timeoutMs });
      if (res.code !== 'Ok') throw mapOsrmCode(res.code, res.message);
      return res;
    } catch (err) {
      if (err instanceof ProviderHttpError) {
        const body = err.body as { code?: string; message?: string };
        throw mapOsrmCode(body?.code ?? 'Error', body?.message);
      }
      throw err;
    }
  }
}

function mapOsrmCode(code: string, message?: string): AppError {
  if (code === 'NoRoute' || code === 'NoSegment' || code === 'NoTable') {
    return new AppError('ROUTE_IMPOSSIBLE', undefined, { cause: `${code}: ${message}` });
  }
  if (code === 'TooBig') return new AppError('ROUTE_TOO_LARGE', undefined, { cause: message });
  return new AppError('PROVIDER_UNAVAILABLE', undefined, { cause: `${code}: ${message}` });
}
