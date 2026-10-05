import { statsQuerySchema, type StatsDto } from '@derepart/shared';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth';
import type { AppDeps } from '../context';
import { deliveries, routes } from '../db/schema';

export function statsHttp(app: FastifyInstance, deps: AppDeps) {
  app.get('/api/stats', async (req): Promise<StatsDto> => {
    const ctx = requireAuth(req);
    const q = statsQuerySchema.parse(req.query);
    const conds = [eq(routes.orgId, ctx.orgId), eq(routes.userId, ctx.userId), eq(routes.status, 'completed')];
    if (q.from) conds.push(gte(routes.completedAt, new Date(`${q.from}T00:00:00Z`)));
    if (q.to) conds.push(lt(routes.completedAt, new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000)));
    const where = and(...conds);

    const [agg] = await deps.db
      .select({
        routes: sql<number>`count(*)::int`,
        distanceM: sql<number>`coalesce(sum(${routes.actualDistanceM}), 0)::float8`,
        timeS: sql<number>`coalesce(sum(${routes.actualDurationS}), 0)::float8`,
        savedDistanceM: sql<number>`coalesce(sum(${routes.savedDistanceM}), 0)::float8`,
        savedDurationS: sql<number>`coalesce(sum(${routes.savedDurationS}), 0)::float8`,
        // fuel saved only where the route had a consumption configured
        savedFuelL: sql<number | null>`sum(${routes.savedDistanceM} / 1000 * ${routes.fuelConsumptionL100} / 100)::float8`,
      })
      .from(routes)
      .where(where);

    const [d] = await deps.db
      .select({
        done: sql<number>`count(*) filter (where ${deliveries.status} = 'delivered')::int`,
        failed: sql<number>`count(*) filter (where ${deliveries.status} = 'failed')::int`,
        skipped: sql<number>`count(*) filter (where ${deliveries.status} = 'skipped')::int`,
      })
      .from(deliveries)
      .innerJoin(routes, eq(routes.id, deliveries.routeId))
      .where(where);

    const attempted = d.done + d.failed;
    const distanceKm = agg.distanceM / 1000;
    return {
      routes: agg.routes,
      deliveriesDone: d.done,
      deliveriesFailed: d.failed,
      deliveriesSkipped: d.skipped,
      successRate: attempted > 0 ? d.done / attempted : null,
      distanceKm,
      timeOnRouteS: agg.timeS,
      kmPerDelivery: d.done > 0 ? distanceKm / d.done : null,
      savedDistanceKm: agg.savedDistanceM / 1000,
      savedDurationS: agg.savedDurationS,
      savedFuelL: agg.savedFuelL,
    };
  });
}
