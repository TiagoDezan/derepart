// Response shapes of the HTTP API.
import type {
  DeliverySource,
  DeliveryStatus,
  FailureReason,
  NavApp,
  OptimizationMode,
  Priority,
  RouteEventType,
  RouteStatus,
  VehicleType,
} from './domain';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  orgId: string;
  createdAt: string;
}

export interface SettingsDto {
  defaultMode: OptimizationMode;
  navApp: NavApp;
  serviceTimeS: number;
  allowAiImages: boolean;
  retentionDays: number;
}

export interface VehicleDto {
  id: string;
  name: string;
  type: VehicleType;
  fuelConsumptionL100: number | null;
  fuelPriceEurL: number | null;
  isDefault: boolean;
}

export interface SavedPlaceDto {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export interface MeDto {
  user: UserDto;
  settings: SettingsDto;
}

export interface DeliveryDto {
  id: string;
  routeId: string;
  recipientName: string | null;
  phone: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
  formattedAddress: string;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  priority: Priority;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  status: DeliveryStatus;
  failureReason: FailureReason | null;
  failureNote: string | null;
  /** 1-based position in the optimized route; null before optimization. */
  sequence: number | null;
  /** Leg from the previous stop (or start) to this one. */
  legDistanceM: number | null;
  legDurationS: number | null;
  etaAt: string | null;
  /** Arrival outside its time window, according to the last plan. */
  windowViolated: boolean;
  deliveredAt: string | null;
  source: DeliverySource;
  confidence: number | null;
  createdAt: string;
}

export interface RouteComplexity {
  maneuvers: number;
  roadChanges: number;
  maneuversPerKm: number;
}

export interface PlanTotals {
  distanceM: number;
  /** Driving time only. */
  drivingS: number;
  /** Driving + service time at stops + waiting for time windows. */
  durationS: number;
}

export interface RoutePlanDto {
  provider: string;
  trafficAware: boolean;
  computedAt: string;
  departureAt: string;
  method: string;
  /** Encoded polyline (precision 5) of the remaining planned route. */
  geometry: string | null;
  /** Totals of the whole route (executed legs + remaining plan), from the detailed route. */
  totals: PlanTotals;
  /** Remaining part only (what was optimized in the last calculation). */
  remaining: PlanTotals;
  /**
   * Original (insertion) order vs. optimized order of the stops optimized in the last
   * calculation — both measured with the same distance matrix, so the difference is fair.
   */
  comparison: { baseline: PlanTotals; optimized: PlanTotals } | null;
  /** Number of stops included in the last optimization (remaining stops on a recalculation). */
  stopsOptimized: number;
  returnLeg: { distanceM: number; durationS: number } | null;
  complexity: RouteComplexity | null;
  serviceTimeS: number;
  warnings: string[];
  /** Deliveries changed after this plan was computed — recalculation recommended. */
  stale: boolean;
}

export interface RouteSummaryDto {
  id: string;
  name: string;
  status: RouteStatus;
  optimizationMode: OptimizationMode;
  returnToStart: boolean;
  start: { label: string | null; lat: number | null; lng: number | null };
  deliveriesTotal: number;
  deliveriesDone: number;
  deliveriesFailed: number;
  plannedDistanceM: number | null;
  plannedDurationS: number | null;
  baselineDistanceM: number | null;
  baselineDurationS: number | null;
  actualDistanceM: number | null;
  actualDurationS: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  piiPurged: boolean;
}

export interface RouteDto extends RouteSummaryDto {
  vehicle: {
    id: string | null;
    type: VehicleType;
    fuelConsumptionL100: number | null;
    fuelPriceEurL: number | null;
  };
  plan: RoutePlanDto | null;
  deliveries: DeliveryDto[];
}

export type AddressIssue =
  | 'number_mismatch'
  | 'number_missing'
  | 'postal_code_mismatch'
  | 'postal_code_invalid'
  | 'province_mismatch'
  | 'city_mismatch'
  | 'street_mismatch'
  | 'low_precision';

export interface AddressCorrection {
  field: 'street' | 'number' | 'postalCode' | 'city' | 'province';
  from: string | null;
  to: string | null;
}

export interface GeocodeCandidate {
  formattedAddress: string;
  street: string | null;
  number: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
  lat: number;
  lng: number;
  precision: 'rooftop' | 'street' | 'locality' | 'approximate';
  provider: string;
  /** 0–1 agreement between the input and this candidate. */
  score: number;
  issues: AddressIssue[];
  corrections: AddressCorrection[];
}

export interface GeocodeResponse {
  status: 'ok' | 'needs_review' | 'ambiguous' | 'not_found';
  best: GeocodeCandidate | null;
  candidates: GeocodeCandidate[];
  /** Human-readable explanation for the user (pt-BR). */
  messages: string[];
}

export interface ParsedLabel {
  recipientName: string | null;
  phone: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
  notes: string | null;
}

export interface RecognitionResult {
  fields: ParsedLabel;
  /** 0–1 overall confidence (parse completeness + OCR + geocoder agreement). */
  confidence: number;
  usedAi: boolean;
  aiProvider: string | null;
  /** True when the AI step would help but was not available / not allowed. */
  aiSuggested: boolean;
  geocode: GeocodeResponse | null;
  warnings: string[];
}

export interface RouteEventDto {
  id: string;
  type: RouteEventType;
  deliveryId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface OptimizeResultDto {
  route: RouteDto;
  /** Savings vs. original order; null when not comparable. */
  savings: { distanceM: number; durationS: number } | null;
}

export interface StatsDto {
  routes: number;
  deliveriesDone: number;
  deliveriesFailed: number;
  deliveriesSkipped: number;
  successRate: number | null;
  distanceKm: number;
  timeOnRouteS: number;
  kmPerDelivery: number | null;
  savedDistanceKm: number;
  savedDurationS: number;
  savedFuelL: number | null;
}

export interface PublicConfigDto {
  /** 'supabase': sign in with Supabase Auth in the app; 'local': /api/auth/* endpoints. */
  authProvider: 'local' | 'supabase';
  mapProvider: string;
  trafficAware: boolean;
  roadPreferences: boolean;
  geocoders: string[];
  aiProvider: string | null;
  maxStops: number;
}
