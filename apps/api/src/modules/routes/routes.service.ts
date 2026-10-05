import {
  OPEN_DELIVERY_STATUSES,
  OPTIMIZATION_PROFILES,
  type ClientEvent,
  type CreateDeliveryInput,
  type CreateRouteInput,
  type DeliveryStatus,
  type LatLng,
  type OptimizationMode,
  type OptimizeResultDto,
  type OptimizeRouteInput,
  type PlanTotals,
  type Priority,
  type RouteDto,
  type RouteEventType,
  type RoutePlanDto,
  type RouteSummaryDto,
  type UpdateDeliveryInput,
  type UpdateRouteInput,
  type VehicleType,
} from '@derepart/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDeps, AuthContext } from '../../context';
import { deliveries, routeEvents, routes, userSettings, vehicles, type DeliveryRow, type RouteRow } from '../../db/schema';
import type { Db } from '../../db/client';
import { AppError } from '../../lib/errors';
import { Objective, sanitizeMatrix } from '../../optimization/evaluator';
import type { SolverStop } from '../../optimization/types';
import { toRouteDto, toRouteSummaryDto } from '../mappers';
import { formatClock, windowOffsetS } from './timeWindows';

const OPEN = OPEN_DELIVERY_STATUSES as DeliveryStatus[];
const LOCKED_STATUSES = ['completed', 'cancelled'];

export class RoutesService {
  constructor(private readonly deps: AppDeps) {}

  private get db(): Db {
    return this.deps.db;
  }

  // ---------------------------------------------------------------------------
  // Queries

  private scope(ctx: AuthContext) {
    return and(eq(routes.orgId, ctx.orgId), eq(routes.userId, ctx.userId));
  }

  private async loadRoute(ctx: AuthContext, id: string, db: Db = this.db): Promise<RouteRow> {
    const [row] = await db
      .select()
      .from(routes)
      .where(and(eq(routes.id, id), this.scope(ctx)));
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async loadDeliveries(routeId: string, db: Db = this.db): Promise<DeliveryRow[]> {
    return db.select().from(deliveries).where(eq(deliveries.routeId, routeId)).orderBy(asc(deliveries.createdAt));
  }

  async getRoute(ctx: AuthContext, id: string): Promise<RouteDto> {
    const route = await this.loadRoute(ctx, id);
    return toRouteDto(route, await this.loadDeliveries(id), this.deps.cipher);
  }

  async listRoutes(ctx: AuthContext, opts: { limit: number; offset: number; status?: string[] }): Promise<RouteSummaryDto[]> {
    const where = opts.status?.length ? and(this.scope(ctx), inArray(routes.status, opts.status)) : this.scope(ctx);
    const rows = await this.db
      .select({
        route: routes,
        total: sql<number>`count(${deliveries.id})::int`,
        done: sql<number>`count(${deliveries.id}) filter (where ${deliveries.status} = 'delivered')::int`,
        failed: sql<number>`count(${deliveries.id}) filter (where ${deliveries.status} = 'failed')::int`,
      })
      .from(routes)
      .leftJoin(deliveries, eq(deliveries.routeId, routes.id))
      .where(where)
      .groupBy(routes.id)
      .orderBy(desc(routes.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
    return rows.map((r) => toRouteSummaryDto(r.route, { total: r.total, done: r.done, failed: r.failed }));
  }

  /** "Continuar rota": the route in progress, or the latest not-yet-finished one. */
  async getActiveRoute(ctx: AuthContext): Promise<RouteSummaryDto | null> {
    const [inProgress] = await this.listRoutes(ctx, { limit: 1, offset: 0, status: ['in_progress'] });
    if (inProgress) return inProgress;
    const [open] = await this.listRoutes(ctx, { limit: 1, offset: 0, status: ['planned', 'draft'] });
    return open ?? null;
  }

  // ---------------------------------------------------------------------------
  // Route CRUD

  async createRoute(ctx: AuthContext, input: CreateRouteInput & { optimizationMode: OptimizationMode }): Promise<RouteDto> {
    const vehicle = await this.resolveVehicle(ctx, input.vehicleId ?? null);
    const name =
      input.name ||
      `Rota ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date())}`;
    const [row] = await this.db
      .insert(routes)
      .values({
        orgId: ctx.orgId,
        userId: ctx.userId,
        vehicleId: vehicle?.id ?? null,
        name,
        optimizationMode: input.optimizationMode,
        returnToStart: input.returnToStart ?? false,
        startLabel: input.start.label,
        startLat: input.start.lat,
        startLng: input.start.lng,
        vehicleType: vehicle?.type ?? 'car',
        fuelConsumptionL100: vehicle?.fuelConsumptionL100 ?? null,
        fuelPriceEurL: vehicle?.fuelPriceEurL ?? null,
      })
      .returning();
    await this.logEvent(ctx, row.id, 'route_created', null, {});
    return toRouteDto(row, [], this.deps.cipher);
  }

  async updateRoute(ctx: AuthContext, id: string, input: UpdateRouteInput): Promise<RouteDto> {
    const route = await this.loadRoute(ctx, id);
    this.assertEditable(route);
    const patch: Partial<typeof routes.$inferInsert> = {};
    let invalidates = false;
    if (input.name) patch.name = input.name;
    if (input.start) {
      Object.assign(patch, { startLabel: input.start.label, startLat: input.start.lat, startLng: input.start.lng });
      invalidates = true;
    }
    if (input.returnToStart !== undefined && input.returnToStart !== route.returnToStart) {
      patch.returnToStart = input.returnToStart;
      invalidates = true;
    }
    if (input.optimizationMode && input.optimizationMode !== route.optimizationMode) {
      patch.optimizationMode = input.optimizationMode;
      invalidates = true;
    }
    if (input.vehicleId !== undefined) {
      const v = await this.resolveVehicle(ctx, input.vehicleId ?? null);
      Object.assign(patch, {
        vehicleId: v?.id ?? null,
        vehicleType: v?.type ?? 'car',
        fuelConsumptionL100: v?.fuelConsumptionL100 ?? null,
        fuelPriceEurL: v?.fuelPriceEurL ?? null,
      });
      invalidates = invalidates || (v?.type ?? 'car') !== route.vehicleType;
    }
    if (invalidates && route.plan) patch.plan = { ...route.plan, stale: true };
    if (Object.keys(patch).length) await this.db.update(routes).set(patch).where(eq(routes.id, id));
    return this.getRoute(ctx, id);
  }

  async deleteRoute(ctx: AuthContext, id: string): Promise<void> {
    await this.loadRoute(ctx, id);
    await this.db.delete(routes).where(and(eq(routes.id, id), this.scope(ctx)));
  }

  /** Deletes every route (and its deliveries/events) of the user. */
  async deleteAllRoutes(ctx: AuthContext): Promise<number> {
    const res = await this.db.delete(routes).where(this.scope(ctx)).returning({ id: routes.id });
    return res.length;
  }

  // ---------------------------------------------------------------------------
  // Deliveries

  async addDelivery(ctx: AuthContext, routeId: string, input: CreateDeliveryInput): Promise<RouteDto> {
    const route = await this.loadRoute(ctx, routeId);
    this.assertEditable(route);
    const count = await this.db.$count(deliveries, eq(deliveries.routeId, routeId));
    if (count >= 150) throw new AppError('ROUTE_TOO_LARGE');
    const { cipher } = this.deps;
    const [row] = await this.db
      .insert(deliveries)
      .values({
        routeId,
        orgId: ctx.orgId,
        recipientNameEnc: cipher.encrypt(input.recipientName),
        phoneEnc: cipher.encrypt(input.phone),
        complementEnc: cipher.encrypt(input.complement),
        notesEnc: cipher.encrypt(input.notes),
        street: input.street,
        number: input.number ?? null,
        postalCode: input.postalCode ?? null,
        city: input.city ?? null,
        province: input.province ?? null,
        country: input.country ?? 'ES',
        formattedAddress: input.formattedAddress,
        lat: input.lat,
        lng: input.lng,
        priority: input.priority ?? 'normal',
        timeWindowStart: input.timeWindowStart ?? null,
        timeWindowEnd: input.timeWindowEnd ?? null,
        source: input.source ?? 'manual',
        confidence: input.confidence ?? null,
      })
      .returning();
    await this.markStale(route);
    await this.logEvent(ctx, routeId, 'delivery_added', row.id, { source: row.source, duringRoute: route.status === 'in_progress' });
    return this.getRoute(ctx, routeId);
  }

  async updateDelivery(ctx: AuthContext, routeId: string, deliveryId: string, input: UpdateDeliveryInput): Promise<RouteDto> {
    const route = await this.loadRoute(ctx, routeId);
    this.assertEditable(route);
    const existing = await this.loadDelivery(routeId, deliveryId);
    const { cipher } = this.deps;
    const patch: Partial<typeof deliveries.$inferInsert> = {};
    if (input.recipientName !== undefined) patch.recipientNameEnc = cipher.encrypt(input.recipientName);
    if (input.phone !== undefined) patch.phoneEnc = cipher.encrypt(input.phone);
    if (input.complement !== undefined) patch.complementEnc = cipher.encrypt(input.complement);
    if (input.notes !== undefined) patch.notesEnc = cipher.encrypt(input.notes);
    for (const k of ['street', 'number', 'postalCode', 'city', 'province', 'country', 'formattedAddress', 'priority', 'timeWindowStart', 'timeWindowEnd', 'source', 'confidence'] as const) {
      if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
    }
    const moved = (input.lat !== undefined && input.lat !== existing.lat) || (input.lng !== undefined && input.lng !== existing.lng);
    if (input.lat !== undefined) patch.lat = input.lat;
    if (input.lng !== undefined) patch.lng = input.lng;
    if (Object.keys(patch).length) await this.db.update(deliveries).set(patch).where(eq(deliveries.id, deliveryId));
    const affectsPlan = moved || input.priority !== undefined || input.timeWindowStart !== undefined || input.timeWindowEnd !== undefined;
    if (affectsPlan) await this.markStale(route);
    await this.logEvent(ctx, routeId, 'delivery_updated', deliveryId, { affectsPlan });
    return this.getRoute(ctx, routeId);
  }

  async removeDelivery(ctx: AuthContext, routeId: string, deliveryId: string): Promise<RouteDto> {
    const route = await this.loadRoute(ctx, routeId);
    this.assertEditable(route);
    await this.loadDelivery(routeId, deliveryId);
    await this.db.delete(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.routeId, routeId)));
    await this.markStale(route);
    await this.logEvent(ctx, routeId, 'delivery_removed', deliveryId, {});
    return this.getRoute(ctx, routeId);
  }

  private async loadDelivery(routeId: string, deliveryId: string): Promise<DeliveryRow> {
    const [row] = await this.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.routeId, routeId)));
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  // ---------------------------------------------------------------------------
  // Optimisation (initial plan and recalculation of the remaining stops)

  async optimize(ctx: AuthContext, routeId: string, input: OptimizeRouteInput): Promise<OptimizeResultDto> {
    const route = await this.loadRoute(ctx, routeId);
    this.assertEditable(route);
    const all = await this.loadDeliveries(routeId);
    const open = all.filter((d) => OPEN.includes(d.status as DeliveryStatus) && d.lat != null && d.lng != null);
    const done = all.filter((d) => !OPEN.includes(d.status as DeliveryStatus));
    if (open.length === 0) throw new AppError('NO_DELIVERIES');
    if (route.startLat == null || route.startLng == null) throw new AppError('VALIDATION', { fields: { start: 'Ponto de partida ausente' } });

    const mode = (input.optimizationMode ?? route.optimizationMode) as OptimizationMode;
    const settings = await this.settingsFor(ctx);
    const departure = input.departureAt ? new Date(input.departureAt) : new Date();
    const start: LatLng = { lat: route.startLat, lng: route.startLng };

    // Origin: GPS position when recalculating; else the last visited stop; else the start.
    const lastVisited = [...done]
      .filter((d) => d.lat != null && d.sequence != null && d.status !== 'skipped')
      .sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0))[0];
    const origin: LatLng = input.position
      ? input.position
      : route.status === 'in_progress' && lastVisited
        ? { lat: lastVisited.lat!, lng: lastVisited.lng! }
        : start;
    const originIsStart = origin.lat === start.lat && origin.lng === start.lng;

    const points: LatLng[] = [origin, ...open.map((d) => ({ lat: d.lat!, lng: d.lng! }))];
    let end: 'free' | 'origin' | number = 'free';
    if (route.returnToStart) {
      if (originIsStart) end = 'origin';
      else {
        points.push(start);
        end = points.length - 1;
      }
    }

    const warnings: string[] = [];
    // A window that already closed cannot be met: it is reported, but not used to reorder the
    // route (otherwise the lateness penalty would pull that stop to the front for nothing).
    const windowPassed = new Set<string>();
    const stops: SolverStop[] = open.map((d, i) => {
      const ws = windowOffsetS(d.timeWindowStart, departure);
      const we = windowOffsetS(d.timeWindowEnd, departure);
      const passed = we != null && we < 0;
      if (passed) {
        windowPassed.add(d.id);
        warnings.push(`A janela de horário de "${d.formattedAddress}" (até ${d.timeWindowEnd}) já passou.`);
      }
      return {
        node: i + 1,
        serviceS: settings.serviceTimeS,
        priority: d.priority as Priority,
        windowStartS: ws != null && !passed ? Math.max(0, ws) : null,
        windowEndS: passed ? null : we,
      };
    });

    const opts = { vehicle: route.vehicleType as VehicleType, mode, departureAt: departure };
    let result;
    try {
      result = await this.deps.maps.optimizeRoute({ points, stops, end, opts });
    } catch (err) {
      if (err instanceof AppError && err.code === 'ROUTE_IMPOSSIBLE' && Array.isArray(err.details?.unreachableNodes)) {
        const ids = (err.details.unreachableNodes as number[]).map((n) => open[n - 1]?.id).filter(Boolean);
        throw new AppError('ROUTE_IMPOSSIBLE', { deliveryIds: ids });
      }
      throw err;
    }
    const { solution, route: detail, matrix } = result;

    // Baseline: same stops in insertion order, measured with the same matrix → fair comparison.
    const profile = OPTIMIZATION_PROFILES[mode];
    const clean = sanitizeMatrix(matrix.durations, matrix.distances, [0, ...stops.map((s) => s.node), ...(typeof end === 'number' ? [end] : [])]);
    const objective = new Objective({
      durations: clean.durations,
      distances: clean.distances,
      stops,
      end,
      weights: { time: profile.time, distance: profile.distance },
    });
    const insertionOrder = [...open]
      .map((d, i) => ({ d, node: i + 1 }))
      .sort((a, b) => a.d.createdAt.getTime() - b.d.createdAt.getTime())
      .map((x) => x.node);
    const baselineEval = objective.evaluate(insertionOrder);
    const optimizedEval = solution.evaluation;

    // Walk the detailed legs to compute per-stop leg, ETA and window violations.
    const legs = detail.legs;
    let t = 0;
    const updates: { id: string; sequence: number; legDistanceM: number; legDurationS: number; etaAt: Date; windowViolated: boolean }[] = [];
    const executedSeq = Math.max(0, ...done.map((d) => d.sequence ?? 0));
    solution.order.forEach((node, k) => {
      const d = open[node - 1];
      const stop = stops[node - 1];
      const leg = legs[k] ?? { distanceM: 0, durationS: 0 };
      t += leg.durationS;
      if (stop.windowStartS != null && t < stop.windowStartS) t = stop.windowStartS;
      const violated = windowPassed.has(d.id) || (stop.windowEndS != null && t > stop.windowEndS);
      const eta = new Date(departure.getTime() + t * 1000);
      if (violated && !windowPassed.has(d.id)) {
        warnings.push(
          `Não dá para chegar a "${d.formattedAddress}" dentro da janela ${d.timeWindowStart ?? '…'}–${d.timeWindowEnd} (chegada prevista ${formatClock(eta)}).`,
        );
      }
      updates.push({ id: d.id, sequence: executedSeq + k + 1, legDistanceM: leg.distanceM, legDurationS: leg.durationS, etaAt: eta, windowViolated: violated });
      t += stop.serviceS;
    });
    const returnLegRaw = end !== 'free' ? legs[solution.order.length] : undefined;
    if (returnLegRaw) t += returnLegRaw.durationS;

    const executed = done
      .filter((d) => d.status === 'delivered' || d.status === 'failed')
      .reduce(
        (acc, d) => ({ distanceM: acc.distanceM + (d.legDistanceM ?? 0), drivingS: acc.drivingS + (d.legDurationS ?? 0) }),
        { distanceM: 0, drivingS: 0 },
      );
    const executedDurationS = route.startedAt ? Math.max(0, (departure.getTime() - route.startedAt.getTime()) / 1000) : 0;
    const remaining: PlanTotals = { distanceM: detail.distanceM, drivingS: detail.durationS, durationS: t };
    const totals: PlanTotals = {
      distanceM: executed.distanceM + remaining.distanceM,
      drivingS: executed.drivingS + remaining.drivingS,
      durationS: executedDurationS + remaining.durationS,
    };
    const asTotals = (e: typeof baselineEval): PlanTotals => ({ distanceM: e.distanceM, drivingS: e.drivingS, durationS: e.totalS });

    if (!detail.trafficAware) warnings.push('Tempos estimados sem trânsito em tempo real.');
    if (result.simplerAlternativeChosen) {
      warnings.push('Escolhemos uma sequência quase tão rápida, mas com menos manobras (modo equilibrado).');
    }

    const recalculation = route.status === 'in_progress' || route.plan != null;
    const plan: RoutePlanDto = {
      provider: this.deps.maps.routingName,
      trafficAware: detail.trafficAware,
      computedAt: new Date().toISOString(),
      departureAt: departure.toISOString(),
      method: solution.method,
      geometry: detail.geometry || null,
      totals,
      remaining,
      comparison: open.length > 1 ? { baseline: asTotals(baselineEval), optimized: asTotals(optimizedEval) } : null,
      stopsOptimized: open.length,
      returnLeg: returnLegRaw ? { distanceM: returnLegRaw.distanceM, durationS: returnLegRaw.durationS } : null,
      complexity: detail.complexity,
      serviceTimeS: settings.serviceTimeS,
      warnings,
      stale: false,
    };

    await this.db.transaction(async (tx) => {
      for (const u of updates) {
        await tx
          .update(deliveries)
          .set({ sequence: u.sequence, legDistanceM: u.legDistanceM, legDurationS: u.legDurationS, etaAt: u.etaAt, windowViolated: u.windowViolated })
          .where(eq(deliveries.id, u.id));
      }
      await tx
        .update(routes)
        .set({
          plan,
          optimizationMode: mode,
          status: route.status === 'draft' ? 'planned' : route.status,
          plannedDistanceM: executed.distanceM + optimizedEval.distanceM,
          plannedDurationS: executedDurationS + optimizedEval.totalS,
          baselineDistanceM: executed.distanceM + baselineEval.distanceM,
          baselineDurationS: executedDurationS + baselineEval.totalS,
          ...(route.status === 'in_progress'
            ? {}
            : {
                savedDistanceM: Math.max(0, baselineEval.distanceM - optimizedEval.distanceM),
                savedDurationS: Math.max(0, baselineEval.totalS - optimizedEval.totalS),
              }),
        })
        .where(eq(routes.id, routeId));
      if (route.status === 'in_progress') await this.refreshEnRoute(routeId, tx as unknown as Db);
    });

    await this.logEvent(ctx, routeId, recalculation && route.status === 'in_progress' ? 'route_recalculated' : 'route_optimized', null, {
      stops: open.length,
      method: solution.method,
      provider: plan.provider,
      fromPosition: input.position != null,
      distanceM: Math.round(totals.distanceM),
      durationS: Math.round(totals.durationS),
      elapsedMs: solution.elapsedMs,
    });

    return {
      route: await this.getRoute(ctx, routeId),
      savings: plan.comparison
        ? {
            distanceM: plan.comparison.baseline.distanceM - plan.comparison.optimized.distanceM,
            durationS: plan.comparison.baseline.durationS - plan.comparison.optimized.durationS,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Running the route

  async startRoute(ctx: AuthContext, routeId: string): Promise<RouteDto> {
    const route = await this.loadRoute(ctx, routeId);
    this.assertEditable(route);
    if (!route.plan) throw new AppError('CONFLICT', { reason: 'not_optimized' }, { message: 'Calcule a rota antes de iniciar.' });
    if (route.status !== 'in_progress') {
      // Only one route in progress at a time: pause others back to "planned".
      await this.db
        .update(routes)
        .set({ status: 'planned' })
        .where(and(this.scope(ctx), eq(routes.status, 'in_progress')));
      await this.db.update(routes).set({ status: 'in_progress', startedAt: route.startedAt ?? new Date() }).where(eq(routes.id, routeId));
      await this.refreshEnRoute(routeId);
      await this.logEvent(ctx, routeId, 'route_started', null, {});
    }
    return this.getRoute(ctx, routeId);
  }

  /**
   * Applies client events (possibly recorded offline). Each event id is stored once,
   * so re-sending the same batch is harmless.
   */
  async applyEvents(ctx: AuthContext, routeId: string, events: ClientEvent[]): Promise<{ route: RouteDto; applied: number; duplicates: number }> {
    const route = await this.loadRoute(ctx, routeId);
    if (route.status === 'cancelled') throw new AppError('ROUTE_NOT_EDITABLE');
    const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    let applied = 0;
    let duplicates = 0;
    await this.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      for (const ev of sorted) {
        if (ev.deliveryId) {
          const [d] = await tx
            .select({ id: deliveries.id })
            .from(deliveries)
            .where(and(eq(deliveries.id, ev.deliveryId), eq(deliveries.routeId, routeId)));
          if (!d) continue; // delivery deleted meanwhile: ignore
        }
        const inserted = await tx
          .insert(routeEvents)
          .values({
            id: ev.id,
            routeId,
            orgId: ctx.orgId,
            userId: ctx.userId,
            deliveryId: ev.deliveryId ?? null,
            type: ev.type,
            payload: { reason: ev.reason ?? null, hasNote: !!ev.note },
            occurredAt: new Date(ev.occurredAt),
          })
          .onConflictDoNothing()
          .returning({ id: routeEvents.id });
        if (inserted.length === 0) {
          duplicates++;
          continue;
        }
        applied++;
        if (!ev.deliveryId) continue;
        const at = new Date(ev.occurredAt);
        const set: Partial<typeof deliveries.$inferInsert> =
          ev.type === 'delivery_completed'
            ? { status: 'delivered', deliveredAt: at, failureReason: null, failureNoteEnc: null }
            : ev.type === 'delivery_failed'
              ? { status: 'failed', deliveredAt: null, failureReason: ev.reason ?? 'other', failureNoteEnc: this.deps.cipher.encrypt(ev.note) }
              : ev.type === 'delivery_skipped'
                ? { status: 'skipped', deliveredAt: null }
                : ev.type === 'delivery_reset'
                  ? { status: 'pending', deliveredAt: null, failureReason: null, failureNoteEnc: null }
                  : {};
        if (Object.keys(set).length) await tx.update(deliveries).set(set).where(eq(deliveries.id, ev.deliveryId));
      }
      if (route.status === 'in_progress') await this.refreshEnRoute(routeId, tx);
    });
    return { route: await this.getRoute(ctx, routeId), applied, duplicates };
  }

  async completeRoute(ctx: AuthContext, routeId: string, opts: { skipRemaining: boolean }): Promise<RouteDto> {
    const route = await this.loadRoute(ctx, routeId);
    if (route.status === 'completed') return this.getRoute(ctx, routeId);
    this.assertEditable(route);
    const now = new Date();
    if (opts.skipRemaining) {
      await this.db
        .update(deliveries)
        .set({ status: 'skipped' })
        .where(and(eq(deliveries.routeId, routeId), inArray(deliveries.status, OPEN)));
    }
    const all = await this.loadDeliveries(routeId);
    const driven = all.filter((d) => d.status === 'delivered' || d.status === 'failed');
    // Distance actually driven is not tracked by GPS (privacy); it is estimated from the
    // legs between visited stops (+ the return leg when the route returns to start).
    const distance = driven.reduce((s, d) => s + (d.legDistanceM ?? 0), 0) + (route.returnToStart ? (route.plan?.returnLeg?.distanceM ?? 0) : 0);
    await this.db
      .update(routes)
      .set({
        status: 'completed',
        completedAt: now,
        actualDurationS: route.startedAt ? (now.getTime() - route.startedAt.getTime()) / 1000 : null,
        actualDistanceM: driven.length ? distance : null,
      })
      .where(eq(routes.id, routeId));
    await this.logEvent(ctx, routeId, 'route_completed', null, {
      delivered: all.filter((d) => d.status === 'delivered').length,
      failed: all.filter((d) => d.status === 'failed').length,
      skipped: all.filter((d) => d.status === 'skipped').length,
    });
    return this.getRoute(ctx, routeId);
  }

  async listEvents(ctx: AuthContext, routeId: string) {
    await this.loadRoute(ctx, routeId);
    const rows = await this.db.select().from(routeEvents).where(eq(routeEvents.routeId, routeId)).orderBy(asc(routeEvents.occurredAt));
    return rows.map((e) => ({
      id: e.id,
      type: e.type as RouteEventType,
      deliveryId: e.deliveryId,
      payload: e.payload,
      occurredAt: e.occurredAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------------------
  // Helpers

  /** The first open stop (by sequence) is "en route"; the other open stops are pending. */
  private async refreshEnRoute(routeId: string, db: Db = this.db) {
    const open = await db
      .select({ id: deliveries.id, sequence: deliveries.sequence, createdAt: deliveries.createdAt })
      .from(deliveries)
      .where(and(eq(deliveries.routeId, routeId), inArray(deliveries.status, OPEN)));
    if (open.length === 0) return;
    open.sort((a, b) => (a.sequence ?? 1e9) - (b.sequence ?? 1e9) || a.createdAt.getTime() - b.createdAt.getTime());
    await db.update(deliveries).set({ status: 'en_route' }).where(eq(deliveries.id, open[0].id));
    const others = open.slice(1).map((o) => o.id);
    if (others.length) await db.update(deliveries).set({ status: 'pending' }).where(inArray(deliveries.id, others));
  }

  private async markStale(route: RouteRow) {
    if (route.plan && !route.plan.stale) {
      await this.db.update(routes).set({ plan: { ...route.plan, stale: true } }).where(eq(routes.id, route.id));
    }
  }

  private assertEditable(route: RouteRow) {
    if (LOCKED_STATUSES.includes(route.status)) throw new AppError('ROUTE_NOT_EDITABLE');
  }

  private async resolveVehicle(ctx: AuthContext, vehicleId: string | null) {
    const where = vehicleId
      ? and(eq(vehicles.id, vehicleId), eq(vehicles.orgId, ctx.orgId))
      : and(eq(vehicles.orgId, ctx.orgId), eq(vehicles.userId, ctx.userId), eq(vehicles.isDefault, true));
    const [v] = await this.db.select().from(vehicles).where(where).limit(1);
    if (vehicleId && !v) throw new AppError('NOT_FOUND');
    return v ?? null;
  }

  private async settingsFor(ctx: AuthContext) {
    const [s] = await this.db.select().from(userSettings).where(eq(userSettings.userId, ctx.userId));
    return { serviceTimeS: s?.serviceTimeS ?? 180 };
  }

  private async logEvent(ctx: AuthContext, routeId: string, type: RouteEventType, deliveryId: string | null, payload: Record<string, unknown>) {
    await this.db.insert(routeEvents).values({
      id: crypto.randomUUID(),
      routeId,
      orgId: ctx.orgId,
      userId: ctx.userId,
      deliveryId,
      type,
      payload,
      occurredAt: new Date(),
    });
  }
}

