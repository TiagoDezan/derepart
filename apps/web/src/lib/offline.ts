import {
  OPEN_DELIVERY_STATUSES,
  type ClientEvent,
  type DeliveryStatus,
  type MeDto,
  type RouteDto,
} from '@derepart/shared';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { api, ApiError, isOffline } from './api';

/**
 * Offline layer:
 *  - the last known version of each route (and of /me) is mirrored in IndexedDB;
 *  - delivery events (delivered / not delivered / skipped) are applied locally at once and
 *    queued in an outbox with a client UUID; they are sent when the connection returns.
 *    The server ignores repeated ids, so retrying is always safe.
 */
interface Schema extends DBSchema {
  routes: { key: string; value: RouteDto };
  outbox: { key: string; value: { routeId: string; event: ClientEvent; queuedAt: number } };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;
function db() {
  dbPromise ??= openDB<Schema>('derepart', 1, {
    upgrade(d) {
      d.createObjectStore('routes');
      d.createObjectStore('outbox');
      d.createObjectStore('kv');
    },
  });
  return dbPromise;
}

const listeners = new Set<() => void>();
export function onOutboxChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

export async function cacheRoute(route: RouteDto) {
  await (await db()).put('routes', route, route.id);
}

export async function cachedRoute(id: string): Promise<RouteDto | undefined> {
  return (await db()).get('routes', id);
}

export async function cacheMe(me: MeDto) {
  await (await db()).put('kv', me, 'me');
}

export async function cachedMe(): Promise<MeDto | undefined> {
  return (await db()).get('kv', 'me') as Promise<MeDto | undefined>;
}

/** Fetches a route, falling back to the offline copy (with pending events re-applied). */
export async function fetchRoute(id: string): Promise<RouteDto> {
  try {
    const route = await api<RouteDto>(`/routes/${id}`);
    const pending = await pendingEvents(id);
    const merged = pending.reduce(applyEventLocally, route);
    await cacheRoute(merged);
    return merged;
  } catch (err) {
    if (isOffline(err)) {
      const cached = await cachedRoute(id);
      if (cached) return cached;
    }
    throw err;
  }
}

export async function pendingEvents(routeId?: string): Promise<ClientEvent[]> {
  const all = await (await db()).getAll('outbox');
  return all
    .filter((o) => !routeId || o.routeId === routeId)
    .sort((a, b) => a.queuedAt - b.queuedAt)
    .map((o) => o.event);
}

export async function outboxCount(): Promise<number> {
  return (await db()).count('outbox');
}

/** Mirrors the server rules so the screen updates instantly, also offline. */
export function applyEventLocally(route: RouteDto, ev: ClientEvent): RouteDto {
  if (!ev.deliveryId) return route;
  const status: Partial<Record<ClientEvent['type'], DeliveryStatus>> = {
    delivery_completed: 'delivered',
    delivery_failed: 'failed',
    delivery_skipped: 'skipped',
    delivery_reset: 'pending',
  };
  const next = status[ev.type];
  if (!next) return route;
  let deliveries = route.deliveries.map((d) =>
    d.id === ev.deliveryId
      ? {
          ...d,
          status: next,
          deliveredAt: next === 'delivered' ? ev.occurredAt : null,
          failureReason: next === 'failed' ? (ev.reason ?? 'other') : null,
          failureNote: next === 'failed' ? (ev.note ?? null) : null,
        }
      : d,
  );
  if (route.status === 'in_progress') {
    const open = deliveries
      .filter((d) => OPEN_DELIVERY_STATUSES.includes(d.status))
      .sort((a, b) => (a.sequence ?? 1e9) - (b.sequence ?? 1e9));
    const current = open[0]?.id;
    deliveries = deliveries.map((d) =>
      OPEN_DELIVERY_STATUSES.includes(d.status) ? { ...d, status: d.id === current ? 'en_route' : 'pending' } : d,
    );
  }
  return {
    ...route,
    deliveries,
    deliveriesDone: deliveries.filter((d) => d.status === 'delivered').length,
    deliveriesFailed: deliveries.filter((d) => d.status === 'failed').length,
  };
}

/** Records an event: local first, then best-effort sync. Returns the updated route. */
export async function recordEvent(route: RouteDto, event: Omit<ClientEvent, 'id' | 'occurredAt'>): Promise<RouteDto> {
  const full: ClientEvent = { ...event, id: crypto.randomUUID(), occurredAt: new Date().toISOString() };
  const updated = applyEventLocally(route, full);
  const d = await db();
  await d.put('outbox', { routeId: route.id, event: full, queuedAt: Date.now() }, full.id);
  await d.put('routes', updated, route.id);
  notify();
  void flushOutbox();
  return updated;
}

let flushing: Promise<void> | null = null;
let onSynced: ((route: RouteDto) => void) | null = null;
export function setSyncedHandler(fn: (route: RouteDto) => void) {
  onSynced = fn;
}

export function flushOutbox(): Promise<void> {
  flushing ??= (async () => {
    try {
      const d = await db();
      const items = await d.getAll('outbox');
      const byRoute = new Map<string, typeof items>();
      for (const it of items) byRoute.set(it.routeId, [...(byRoute.get(it.routeId) ?? []), it]);
      for (const [routeId, list] of byRoute) {
        list.sort((a, b) => a.queuedAt - b.queuedAt);
        try {
          const res = await api<{ route: RouteDto }>(`/routes/${routeId}/events`, {
            method: 'POST',
            body: { events: list.map((l) => l.event) },
          });
          for (const l of list) await d.delete('outbox', l.event.id);
          await cacheRoute(res.route);
          onSynced?.(res.route);
        } catch (err) {
          if (isOffline(err)) return; // try again when back online
          if (err instanceof ApiError && ['NOT_FOUND', 'ROUTE_NOT_EDITABLE', 'VALIDATION', 'FORBIDDEN'].includes(err.code)) {
            // permanent failure: the route was deleted/cancelled — drop these events
            for (const l of list) await d.delete('outbox', l.event.id);
          }
        }
      }
    } finally {
      flushing = null;
      notify();
    }
  })();
  return flushing;
}

export async function clearOfflineData() {
  const d = await db();
  await Promise.all([d.clear('routes'), d.clear('outbox'), d.clear('kv')]);
  notify();
}

export function startBackgroundSync() {
  window.addEventListener('online', () => void flushOutbox());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushOutbox();
  });
  setInterval(() => {
    if (navigator.onLine) void flushOutbox();
  }, 30_000);
  void flushOutbox();
}
