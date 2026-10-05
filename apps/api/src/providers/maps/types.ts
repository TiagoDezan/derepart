import type {
  GeocodeCandidate,
  GeocodeRequest,
  GeocodeResponse,
  LatLng,
  OptimizationMode,
  RouteComplexity,
  VehicleType,
} from '@derepart/shared';
import type { SolveResult, SolverStop } from '../../optimization/types';

export interface RoutingOptions {
  vehicle: VehicleType;
  mode: OptimizationMode;
  departureAt?: Date;
}

export interface Matrix {
  /** seconds; `null` = no route between the pair. */
  durations: (number | null)[][];
  /** meters; `null` = no route between the pair. */
  distances: (number | null)[][];
  trafficAware: boolean;
}

export interface RouteLeg {
  distanceM: number;
  durationS: number;
}

export interface RouteResult {
  distanceM: number;
  durationS: number;
  /** Encoded polyline, precision 5. */
  geometry: string;
  legs: RouteLeg[];
  complexity: RouteComplexity;
  trafficAware: boolean;
}

export interface ProviderCapabilities {
  traffic: boolean;
  /** Road preferences (avoid unpaved, prefer main roads) are applied in the query itself. */
  roadPreferences: boolean;
  maxMatrixLocations: number;
  maxRouteWaypoints: number;
}

/** A routing engine: matrix + route geometry. */
export interface RoutingProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  calculateMatrix(points: LatLng[], opts: RoutingOptions): Promise<Matrix>;
  /** `points` in visiting order: origin, waypoints…, destination. */
  calculateRoute(points: LatLng[], opts: RoutingOptions): Promise<RouteResult>;
}

/** Raw candidate from a geocoder, before validation/scoring. */
export type RawCandidate = Omit<GeocodeCandidate, 'score' | 'issues' | 'corrections'> & {
  provinceCode?: string | null;
};

export interface AddressQuery {
  street?: string | null;
  number?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  country: string;
  /** Free text, used when no structured fields exist. */
  query?: string | null;
}

export interface GeocodingProvider {
  readonly name: string;
  geocode(q: AddressQuery): Promise<RawCandidate[]>;
  reverseGeocode(p: LatLng): Promise<RawCandidate | null>;
}

export interface OptimizeRequest {
  /** index 0 = origin. */
  points: LatLng[];
  stops: SolverStop[];
  end: 'free' | 'origin' | number;
  opts: RoutingOptions;
  timeLimitMs?: number;
}

export interface OptimizeResponse {
  matrix: Matrix;
  solution: SolveResult;
  /** Detailed route of the chosen order. */
  route: RouteResult;
  /** True when balanced mode picked a simpler near-optimal alternative. */
  simplerAlternativeChosen: boolean;
}

/**
 * Facade used by the application. Swapping MAP_PROVIDER / GEOCODING_PROVIDERS changes the
 * engines behind it without touching business code.
 */
export interface MapProvider {
  readonly routingName: string;
  readonly geocoderNames: string[];
  readonly capabilities: ProviderCapabilities;
  geocode(address: GeocodeRequest): Promise<GeocodeResponse>;
  reverseGeocode(lat: number, lng: number): Promise<GeocodeCandidate | null>;
  calculateRoute(origin: LatLng, destination: LatLng, waypoints: LatLng[], opts: RoutingOptions): Promise<RouteResult>;
  calculateMatrix(locations: LatLng[], opts: RoutingOptions): Promise<Matrix>;
  optimizeRoute(req: OptimizeRequest): Promise<OptimizeResponse>;
  /** Route details (legs, geometry, complexity) of an already ordered list of points. */
  getRouteDetails(orderedPoints: LatLng[], opts: RoutingOptions): Promise<RouteResult>;
}
