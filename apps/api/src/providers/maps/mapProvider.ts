import {
  decodePolyline,
  encodePolyline,
  OPTIMIZATION_PROFILES,
  type GeocodeCandidate,
  type GeocodeRequest,
  type GeocodeResponse,
  type LatLng,
} from '@derepart/shared';
import { AppError } from '../../lib/errors';
import { TtlCache } from '../../lib/http';
import { sanitizeMatrix } from '../../optimization/evaluator';
import { solve } from '../../optimization/solver';
import type { Solution } from '../../optimization/types';
import { classify, normalizeQuery, scoreCandidate } from './addressMatching';
import type {
  AddressQuery,
  GeocodingProvider,
  MapProvider,
  Matrix,
  OptimizeRequest,
  OptimizeResponse,
  RouteResult,
  RoutingOptions,
  RoutingProvider,
} from './types';

const GOOD_ENOUGH = 0.85;

/**
 * Default MapProvider: a geocoder chain + one routing engine + our own optimiser.
 * The optimiser runs on the matrix of whatever engine is configured, so priorities,
 * windows and profiles behave the same with OSRM, Valhalla or Google.
 */
export class CompositeMapProvider implements MapProvider {
  private readonly geoCache = new TtlCache<GeocodeResponse>(24 * 3600_000);

  constructor(
    private readonly geocoders: GeocodingProvider[],
    private readonly routing: RoutingProvider,
    private readonly optimizerTimeLimitMs: number,
    private readonly log: { warn: (obj: unknown, msg: string) => void } = console,
  ) {
    if (geocoders.length === 0) throw new Error('Nenhum geocoder configurado');
  }

  get routingName() {
    return this.routing.name;
  }

  get geocoderNames() {
    return this.geocoders.map((g) => g.name);
  }

  get capabilities() {
    return this.routing.capabilities;
  }

  async geocode(address: GeocodeRequest): Promise<GeocodeResponse> {
    const q = normalizeQuery({
      street: address.street ?? null,
      number: address.number ?? null,
      postalCode: address.postalCode ?? null,
      city: address.city ?? null,
      province: address.province ?? null,
      country: address.country ?? 'ES',
      query: address.query ?? null,
    });
    if (!q.street && !q.query) throw new AppError('VALIDATION', { fields: { street: 'Informe a rua' } });
    const key = JSON.stringify(q);
    const cached = this.geoCache.get(key);
    if (cached) return cached;

    const scored: GeocodeCandidate[] = [];
    let failures = 0;
    let lastErr: unknown;
    for (const g of this.geocoders) {
      try {
        const raw = await g.geocode(q);
        scored.push(...raw.map((c) => scoreCandidate(q, c)));
      } catch (err) {
        failures++;
        lastErr = err;
        this.log.warn({ err, provider: g.name }, 'geocoder failed, trying next');
        continue;
      }
      if (scored.some((c) => c.score >= GOOD_ENOUGH)) break;
    }
    if (failures === this.geocoders.length) throw lastErr;
    const result = classify(q, scored);
    if (result.status !== 'not_found') this.geoCache.set(key, result);
    return result;
  }

  async reverseGeocode(lat: number, lng: number): Promise<GeocodeCandidate | null> {
    for (const g of this.geocoders) {
      try {
        const c = await g.reverseGeocode({ lat, lng });
        if (c) return { ...scoreCandidate({ country: c.country, query: 'reverse' }, c), score: 1 };
      } catch (err) {
        this.log.warn({ err, provider: g.name }, 'reverse geocoder failed, trying next');
      }
    }
    return null;
  }

  calculateRoute(origin: LatLng, destination: LatLng, waypoints: LatLng[], opts: RoutingOptions): Promise<RouteResult> {
    return this.getRouteDetails([origin, ...waypoints, destination], opts);
  }

  async getRouteDetails(orderedPoints: LatLng[], opts: RoutingOptions): Promise<RouteResult> {
    const max = this.routing.capabilities.maxRouteWaypoints;
    if (orderedPoints.length <= max) return this.routing.calculateRoute(orderedPoints, opts);
    // split into overlapping chunks and stitch
    const parts: RouteResult[] = [];
    for (let i = 0; i < orderedPoints.length - 1; i += max - 1) {
      parts.push(await this.routing.calculateRoute(orderedPoints.slice(i, i + max), opts));
    }
    const shape: [number, number][] = [];
    for (const p of parts) {
      const pts = decodePolyline(p.geometry);
      shape.push(...(shape.length ? pts.slice(1) : pts));
    }
    const distanceM = parts.reduce((s, p) => s + p.distanceM, 0);
    const maneuvers = parts.reduce((s, p) => s + p.complexity.maneuvers, 0);
    return {
      distanceM,
      durationS: parts.reduce((s, p) => s + p.durationS, 0),
      geometry: encodePolyline(shape),
      legs: parts.flatMap((p) => p.legs),
      complexity: {
        maneuvers,
        roadChanges: parts.reduce((s, p) => s + p.complexity.roadChanges, 0),
        maneuversPerKm: distanceM > 0 ? Math.round((maneuvers / (distanceM / 1000)) * 100) / 100 : 0,
      },
      trafficAware: parts.every((p) => p.trafficAware),
    };
  }

  /** Full matrix; splits into blocks when the engine limits the matrix size. */
  async calculateMatrix(locations: LatLng[], opts: RoutingOptions): Promise<Matrix> {
    const n = locations.length;
    const max = this.routing.capabilities.maxMatrixLocations;
    if (n <= max) return this.routing.calculateMatrix(locations, opts);
    const block = Math.floor(max / 2);
    const durations: (number | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null));
    const distances: (number | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null));
    let trafficAware = true;
    for (let a = 0; a < n; a += block) {
      for (let b = 0; b < n; b += block) {
        const ia = range(a, Math.min(n, a + block));
        const ib = b === a ? [] : range(b, Math.min(n, b + block));
        const idx = [...ia, ...ib];
        const sub = await this.routing.calculateMatrix(
          idx.map((i) => locations[i]),
          opts,
        );
        trafficAware &&= sub.trafficAware;
        idx.forEach((gi, li) =>
          idx.forEach((gj, lj) => {
            durations[gi][gj] = sub.durations[li][lj];
            distances[gi][gj] = sub.distances[li][lj];
          }),
        );
      }
    }
    return { durations, distances, trafficAware };
  }

  async optimizeRoute(req: OptimizeRequest): Promise<OptimizeResponse> {
    const profile = OPTIMIZATION_PROFILES[req.opts.mode];
    const matrix = await this.calculateMatrix(req.points, req.opts);
    const relevant = [0, ...req.stops.map((s) => s.node), ...(typeof req.end === 'number' ? [req.end] : [])];
    const clean = sanitizeMatrix(matrix.durations, matrix.distances, relevant);
    if (clean.unreachable.length) {
      throw new AppError('ROUTE_IMPOSSIBLE', { unreachableNodes: clean.unreachable });
    }
    const solution = solve({
      durations: clean.durations,
      distances: clean.distances,
      stops: req.stops,
      end: req.end,
      weights: { time: profile.time, distance: profile.distance },
      timeLimitMs: req.timeLimitMs ?? this.optimizerTimeLimitMs,
      alternatives: profile.preferSimple ? 3 : 1,
    });

    const pointsFor = (s: Solution) => [
      req.points[0],
      ...s.order.map((node) => req.points[node]),
      ...(req.end === 'origin' ? [req.points[0]] : typeof req.end === 'number' ? [req.points[req.end]] : []),
    ];

    if (solution.order.length === 0) {
      return {
        matrix,
        solution,
        route: emptyRoute(matrix.trafficAware),
        simplerAlternativeChosen: false,
      };
    }

    let chosen: Solution = solution;
    let route = await this.getRouteDetails(pointsFor(solution), req.opts);
    let simplerAlternativeChosen = false;

    if (profile.preferSimple && solution.alternatives.length > 1) {
      // Balanced mode: a sequence a few % (or a few minutes) worse but with clearly fewer
      // manoeuvres wins — "don't save 2 minutes at the price of a complicated route".
      const bestTime = solution.evaluation.totalS;
      const candidates = solution.alternatives.filter(
        (a) =>
          a.order.join() !== solution.order.join() &&
          a.evaluation.lateNodes.length <= solution.evaluation.lateNodes.length &&
          (a.evaluation.cost <= solution.evaluation.cost * (1 + profile.simplicityTolerancePct) ||
            a.evaluation.totalS - bestTime <= profile.simplicityToleranceS),
      );
      for (const alt of candidates.slice(0, 2)) {
        try {
          const altRoute = await this.getRouteDetails(pointsFor(alt), req.opts);
          if (altRoute.complexity.maneuvers <= route.complexity.maneuvers * 0.85) {
            chosen = alt;
            route = altRoute;
            simplerAlternativeChosen = true;
          }
        } catch (err) {
          this.log.warn({ err }, 'alternative route details failed; keeping best');
        }
      }
    }

    return {
      matrix,
      solution: { ...solution, order: chosen.order, evaluation: chosen.evaluation },
      route,
      simplerAlternativeChosen,
    };
  }
}

function range(a: number, b: number) {
  return Array.from({ length: b - a }, (_, i) => a + i);
}

function emptyRoute(trafficAware: boolean): RouteResult {
  return {
    distanceM: 0,
    durationS: 0,
    geometry: '',
    legs: [],
    complexity: { maneuvers: 0, roadChanges: 0, maneuversPerKm: 0 },
    trafficAware,
  };
}

export type { AddressQuery };
