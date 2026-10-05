import type {
  DeliveryDto,
  DeliverySource,
  DeliveryStatus,
  FailureReason,
  OptimizationMode,
  Priority,
  RouteDto,
  RouteStatus,
  RouteSummaryDto,
  VehicleDto,
  VehicleType,
} from '@derepart/shared';
import type { DeliveryRow, RouteRow, VehicleRow } from '../db/schema';
import type { FieldCipher } from '../lib/crypto';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toDeliveryDto(d: DeliveryRow, cipher: FieldCipher): DeliveryDto {
  return {
    id: d.id,
    routeId: d.routeId,
    recipientName: cipher.decrypt(d.recipientNameEnc),
    phone: cipher.decrypt(d.phoneEnc),
    street: d.street,
    number: d.number,
    complement: cipher.decrypt(d.complementEnc),
    postalCode: d.postalCode,
    city: d.city,
    province: d.province,
    country: d.country,
    formattedAddress: d.formattedAddress,
    lat: d.lat,
    lng: d.lng,
    notes: cipher.decrypt(d.notesEnc),
    priority: d.priority as Priority,
    timeWindowStart: d.timeWindowStart,
    timeWindowEnd: d.timeWindowEnd,
    status: d.status as DeliveryStatus,
    failureReason: d.failureReason as FailureReason | null,
    failureNote: cipher.decrypt(d.failureNoteEnc),
    sequence: d.sequence,
    legDistanceM: d.legDistanceM,
    legDurationS: d.legDurationS,
    etaAt: iso(d.etaAt),
    windowViolated: d.windowViolated,
    deliveredAt: iso(d.deliveredAt),
    source: d.source as DeliverySource,
    confidence: d.confidence,
    createdAt: d.createdAt.toISOString(),
  };
}

export interface RouteCounts {
  total: number;
  done: number;
  failed: number;
}

export function toRouteSummaryDto(r: RouteRow, counts: RouteCounts): RouteSummaryDto {
  return {
    id: r.id,
    name: r.name,
    status: r.status as RouteStatus,
    optimizationMode: r.optimizationMode as OptimizationMode,
    returnToStart: r.returnToStart,
    start: { label: r.startLabel, lat: r.startLat, lng: r.startLng },
    deliveriesTotal: counts.total,
    deliveriesDone: counts.done,
    deliveriesFailed: counts.failed,
    plannedDistanceM: r.plannedDistanceM,
    plannedDurationS: r.plannedDurationS,
    baselineDistanceM: r.baselineDistanceM,
    baselineDurationS: r.baselineDurationS,
    actualDistanceM: r.actualDistanceM,
    actualDurationS: r.actualDurationS,
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
    createdAt: r.createdAt.toISOString(),
    piiPurged: r.piiPurgedAt != null,
  };
}

/** Deliveries in route order: sequenced first, then by creation. */
export function sortDeliveries<T extends { sequence: number | null; createdAt: Date | string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.sequence != null && b.sequence != null) return a.sequence - b.sequence;
    if (a.sequence != null) return -1;
    if (b.sequence != null) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export function toRouteDto(r: RouteRow, rows: DeliveryRow[], cipher: FieldCipher): RouteDto {
  const deliveries = sortDeliveries(rows).map((d) => toDeliveryDto(d, cipher));
  const counts = {
    total: deliveries.length,
    done: deliveries.filter((d) => d.status === 'delivered').length,
    failed: deliveries.filter((d) => d.status === 'failed').length,
  };
  return {
    ...toRouteSummaryDto(r, counts),
    vehicle: {
      id: r.vehicleId,
      type: r.vehicleType as VehicleType,
      fuelConsumptionL100: r.fuelConsumptionL100,
      fuelPriceEurL: r.fuelPriceEurL,
    },
    plan: r.plan ?? null,
    deliveries,
  };
}

export function toVehicleDto(v: VehicleRow): VehicleDto {
  return {
    id: v.id,
    name: v.name,
    type: v.type as VehicleType,
    fuelConsumptionL100: v.fuelConsumptionL100,
    fuelPriceEurL: v.fuelPriceEurL,
    isDefault: v.isDefault,
  };
}
