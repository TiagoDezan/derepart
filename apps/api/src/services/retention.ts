import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { deliveries, routes, userSettings } from '../db/schema';

/**
 * Privacy retention: after `retention_days` (per user), personal data of finished routes is
 * erased — recipient, phone, address, coordinates, notes, geometry — while the aggregate
 * numbers (distance, time, counts) stay for the statistics.
 * Unfinished routes untouched for twice the period are treated the same way.
 */
export async function purgeExpiredPersonalData(db: Db, defaultDays: number, now = new Date()): Promise<number> {
  const candidates = await db
    .select({ id: routes.id, plan: routes.plan, completedAt: routes.completedAt, updatedAt: routes.updatedAt, days: userSettings.retentionDays })
    .from(routes)
    .leftJoin(userSettings, eq(userSettings.userId, routes.userId))
    .where(
      and(
        isNull(routes.piiPurgedAt),
        or(
          lt(routes.completedAt, sql`${now}::timestamptz - make_interval(days => coalesce(${userSettings.retentionDays}, ${defaultDays}))`),
          lt(routes.updatedAt, sql`${now}::timestamptz - make_interval(days => 2 * coalesce(${userSettings.retentionDays}, ${defaultDays}))`),
        ),
      ),
    );
  if (candidates.length === 0) return 0;
  const ids = candidates.map((c) => c.id);
  await db.transaction(async (tx) => {
    await tx
      .update(deliveries)
      .set({
        recipientNameEnc: null,
        phoneEnc: null,
        complementEnc: null,
        notesEnc: null,
        failureNoteEnc: null,
        street: null,
        number: null,
        lat: null,
        lng: null,
        formattedAddress: 'Dados removidos (retenção)',
      })
      .where(inArray(deliveries.routeId, ids));
    for (const c of candidates) {
      await tx
        .update(routes)
        .set({
          startLabel: null,
          startLat: null,
          startLng: null,
          piiPurgedAt: now,
          plan: c.plan ? { ...c.plan, geometry: null } : null,
        })
        .where(eq(routes.id, c.id));
    }
  });
  return ids.length;
}
