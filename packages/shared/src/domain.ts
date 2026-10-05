// Domain enumerations shared by API and web. Keep values stable: they are persisted.

export const OPTIMIZATION_MODES = ['fastest', 'economic', 'balanced'] as const;
export type OptimizationMode = (typeof OPTIMIZATION_MODES)[number];

export const ROUTE_STATUSES = ['draft', 'planned', 'in_progress', 'completed', 'cancelled'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const DELIVERY_STATUSES = ['pending', 'en_route', 'delivered', 'failed', 'skipped'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Statuses that still need a visit. */
export const OPEN_DELIVERY_STATUSES: readonly DeliveryStatus[] = ['pending', 'en_route'];

export const PRIORITIES = ['normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const VEHICLE_TYPES = ['car', 'motorbike', 'van', 'bicycle', 'other'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const FAILURE_REASONS = ['absent', 'wrong_address', 'refused', 'closed', 'other'] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export const NAV_APPS = ['google', 'waze', 'apple', 'geo'] as const;
export type NavApp = (typeof NAV_APPS)[number];

export const DELIVERY_SOURCES = ['manual', 'ocr', 'ai'] as const;
export type DeliverySource = (typeof DELIVERY_SOURCES)[number];

export const ROUTE_EVENT_TYPES = [
  'route_created',
  'route_optimized',
  'route_recalculated',
  'route_started',
  'route_completed',
  'delivery_added',
  'delivery_updated',
  'delivery_removed',
  'delivery_completed',
  'delivery_failed',
  'delivery_skipped',
  'delivery_reset',
  'off_route_detected',
] as const;
export type RouteEventType = (typeof ROUTE_EVENT_TYPES)[number];

/** Events the client may submit (also offline, via the outbox). */
export const CLIENT_EVENT_TYPES = [
  'delivery_completed',
  'delivery_failed',
  'delivery_skipped',
  'delivery_reset',
  'off_route_detected',
] as const;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'dispatcher', 'driver'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const LABELS = {
  mode: {
    fastest: 'Mais rápido',
    economic: 'Mais econômico',
    balanced: 'Equilibrado',
  } satisfies Record<OptimizationMode, string>,
  modeIcon: { fastest: '⚡', economic: '⛽', balanced: '🛣' } satisfies Record<OptimizationMode, string>,
  deliveryStatus: {
    pending: 'Pendente',
    en_route: 'Em rota',
    delivered: 'Entregue',
    failed: 'Não entregue',
    skipped: 'Ignorada',
  } satisfies Record<DeliveryStatus, string>,
  routeStatus: {
    draft: 'Rascunho',
    planned: 'Planejada',
    in_progress: 'Em andamento',
    completed: 'Concluída',
    cancelled: 'Cancelada',
  } satisfies Record<RouteStatus, string>,
  priority: { normal: 'Normal', high: 'Alta', urgent: 'Urgente' } satisfies Record<Priority, string>,
  vehicle: {
    car: 'Carro',
    motorbike: 'Moto',
    van: 'Van',
    bicycle: 'Bicicleta',
    other: 'Outro',
  } satisfies Record<VehicleType, string>,
  failureReason: {
    absent: 'Cliente ausente',
    wrong_address: 'Endereço incorreto',
    refused: 'Recusado',
    closed: 'Estabelecimento fechado',
    other: 'Outro',
  } satisfies Record<FailureReason, string>,
  navApp: {
    google: 'Google Maps',
    waze: 'Waze',
    apple: 'Apple Maps',
    geo: 'Escolher app (Android)',
  } satisfies Record<NavApp, string>,
};
