import type { GeocodeResponse, OptimizeResultDto, RecognitionResult, RouteDto, RouteSummaryDto, StatsDto } from '@derepart/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { deliveries, routes } from '../db/schema';
import type { AiProvider } from '../providers/ai/types';
import { purgeExpiredPersonalData } from '../services/retention';
import { eq, sql } from 'drizzle-orm';
import { FIXTURE_ADDRESSES, testDeps } from './fakes';

type Deps = Awaited<ReturnType<typeof testDeps>>;

class Client {
  cookie = '';
  constructor(private readonly app: FastifyInstance) {}

  async req<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      payload: body as object | undefined,
      headers: { 'x-derepart-client': 'web', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) this.cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
    return { status: res.statusCode, body: (res.body ? res.json() : null) as T };
  }
}

const start = { label: 'Plaza Costa del Sol, Torremolinos', lat: 36.62226, lng: -4.49986 };

function deliveryInput(i: number, extra: Record<string, unknown> = {}) {
  const a = FIXTURE_ADDRESSES[i];
  return {
    recipientName: `Cliente ${i + 1}`,
    street: a.street,
    number: a.number,
    postalCode: a.postalCode,
    city: a.city,
    formattedAddress: a.formattedAddress,
    lat: a.lat,
    lng: a.lng,
    notes: i === 0 ? 'Deixar na portaria' : null,
    ...extra,
  };
}

describe('full delivery flow (API)', () => {
  let deps: Deps;
  let app: FastifyInstance;
  let alice: Client;
  let routeId: string;
  let plannedSavingsM = 0;

  beforeAll(async () => {
    deps = await testDeps();
    app = await buildApp(deps);
    alice = new Client(app);
  });
  afterAll(async () => {
    await app.close();
    await deps.close();
  });

  it('registers and authenticates with an httpOnly cookie', async () => {
    const r = await alice.req('POST', '/api/auth/register', { name: 'Alice', email: 'Alice@Example.com', password: 'segredo-123' });
    expect(r.status).toBe(201);
    expect(alice.cookie).toMatch(/^derepart_session=/);
    expect((r.body as { token?: string }).token).toBeUndefined(); // web clients never see the token
    const me = await alice.req<{ user: { email: string } }>('GET', '/api/me');
    expect(me.body.user.email).toBe('alice@example.com');
    const dup = await alice.req('POST', '/api/auth/register', { name: 'A', email: 'alice@example.com', password: 'segredo-123' });
    expect(dup.status).toBe(409);
  });

  it('rejects cookie-authenticated mutations without the client header (CSRF)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/routes', payload: { start }, headers: { cookie: alice.cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('returns friendly validation errors', async () => {
    const r = await alice.req<{ error: { code: string; message: string } }>('POST', '/api/routes', { start: { label: '', lat: 999, lng: 0 } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION');
    expect(r.body.error.message).not.toMatch(/zod|error 400/i);
  });

  it('geocodes and validates an address', async () => {
    const r = await alice.req<GeocodeResponse>('POST', '/api/geocode', { street: 'C/ San Miguel', number: '15', postalCode: '29620', city: 'Torremolino' });
    expect(r.status).toBe(200);
    expect(r.body.best?.city).toBe('Torremolinos');
    expect(r.body.best?.corrections.some((c) => c.field === 'city')).toBe(true);
    const wrongNumber = await alice.req<GeocodeResponse>('POST', '/api/geocode', { street: 'Calle San Miguel', number: '99', postalCode: '29620' });
    expect(wrongNumber.body.status).toBe('needs_review');
    expect(wrongNumber.body.best?.issues).toContain('number_mismatch');
  });

  it('creates a route and adds deliveries', async () => {
    const r = await alice.req<RouteDto>('POST', '/api/routes', { start, returnToStart: true, optimizationMode: 'balanced' });
    expect(r.status).toBe(201);
    routeId = r.body.id;
    for (let i = 1; i <= 5; i++) {
      const extra = i === 3 ? { priority: 'urgent' } : i === 5 ? { timeWindowStart: '00:00', timeWindowEnd: '23:59' } : {};
      const add = await alice.req<RouteDto>('POST', `/api/routes/${routeId}/deliveries`, deliveryInput(i, extra));
      expect(add.status).toBe(201);
    }
    const route = await alice.req<RouteDto>('GET', `/api/routes/${routeId}`);
    expect(route.body.deliveries).toHaveLength(5);
    expect(route.body.deliveries[0].recipientName).toBe('Cliente 2'); // decrypted
    expect(route.body.status).toBe('draft');
  });

  it('has row level security enabled on every table (closes Supabase REST access)', async () => {
    const res = await deps.db.execute(sql`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r'`);
    const rows = ((res as unknown as { rows: { relname: string; relrowsecurity: boolean }[] }).rows ?? res) as { relname: string; relrowsecurity: boolean }[];
    expect(rows.length).toBe(10);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it('stores personal fields encrypted at rest', async () => {
    const [row] = await deps.db.select().from(deliveries).where(eq(deliveries.routeId, routeId)).limit(1);
    expect(row.recipientNameEnc).toMatch(/^v1:/);
    expect(row.recipientNameEnc).not.toContain('Cliente');
  });

  it('optimizes the route and compares with the original order', async () => {
    const r = await alice.req<OptimizeResultDto>('POST', `/api/routes/${routeId}/optimize`, {});
    expect(r.status).toBe(200);
    const { route, savings } = r.body;
    expect(route.status).toBe('planned');
    expect(route.plan?.geometry).toBeTruthy();
    expect(route.plan?.returnLeg).not.toBeNull();
    expect(route.deliveries.map((d) => d.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(route.deliveries.every((d) => d.legDistanceM! > 0 && d.etaAt)).toBe(true);
    expect(savings!.distanceM).toBeGreaterThanOrEqual(0);
    plannedSavingsM = savings!.distanceM;
    expect(route.plan!.comparison!.optimized.distanceM).toBeLessThanOrEqual(route.plan!.comparison!.baseline.distanceM);
    // urgent stop (Cliente 4) comes early
    const urgent = route.deliveries.find((d) => d.recipientName === 'Cliente 4')!;
    expect(urgent.sequence).toBeLessThanOrEqual(2);
  });

  it('starts the route and applies offline events idempotently', async () => {
    const started = await alice.req<RouteDto>('POST', `/api/routes/${routeId}/start`);
    expect(started.body.status).toBe('in_progress');
    const first = started.body.deliveries[0];
    expect(first.status).toBe('en_route');

    const event = { id: crypto.randomUUID(), type: 'delivery_completed', deliveryId: first.id, occurredAt: new Date().toISOString() };
    const a = await alice.req<{ applied: number; duplicates: number; route: RouteDto }>('POST', `/api/routes/${routeId}/events`, { events: [event] });
    expect(a.body.applied).toBe(1);
    const b = await alice.req<{ applied: number; duplicates: number; route: RouteDto }>('POST', `/api/routes/${routeId}/events`, { events: [event] });
    expect(b.body.duplicates).toBe(1);
    expect(b.body.route.deliveries[0].status).toBe('delivered');
    expect(b.body.route.deliveries[1].status).toBe('en_route');
  });

  it('adds a delivery during the route and recalculates only the remaining stops', async () => {
    const add = await alice.req<RouteDto>('POST', `/api/routes/${routeId}/deliveries`, deliveryInput(6));
    expect(add.body.plan?.stale).toBe(true);
    const position = { lat: 36.66, lng: -4.5 };
    const r = await alice.req<OptimizeResultDto>('POST', `/api/routes/${routeId}/optimize`, { position });
    expect(r.status).toBe(200);
    const ds = r.body.route.deliveries;
    expect(ds[0].status).toBe('delivered');
    expect(ds[0].sequence).toBe(1); // completed stop keeps its position
    expect(ds.slice(1).map((d) => d.sequence)).toEqual([2, 3, 4, 5, 6]);
    expect(r.body.route.plan?.stale).toBe(false);
    expect(r.body.route.plan?.stopsOptimized).toBe(5);
    expect(ds[1].status).toBe('en_route');
  });

  it('records a failed delivery with a reason and completes the route', async () => {
    const route = (await alice.req<RouteDto>('GET', `/api/routes/${routeId}`)).body;
    const current = route.deliveries.find((d) => d.status === 'en_route')!;
    const fail = await alice.req('POST', `/api/routes/${routeId}/events`, {
      events: [{ id: crypto.randomUUID(), type: 'delivery_failed', deliveryId: current.id, occurredAt: new Date().toISOString(), reason: 'absent', note: 'Ninguém atendeu' }],
    });
    expect(fail.status).toBe(200);
    const done = await alice.req<RouteDto>('POST', `/api/routes/${routeId}/complete`, { skipRemaining: true });
    expect(done.body.status).toBe('completed');
    expect(done.body.actualDurationS).not.toBeNull();
    expect(done.body.deliveries.find((d) => d.id === current.id)?.failureNote).toBe('Ninguém atendeu');
    expect(done.body.deliveries.filter((d) => d.status === 'skipped')).toHaveLength(4);
    const locked = await alice.req<{ error: { code: string } }>('POST', `/api/routes/${routeId}/deliveries`, deliveryInput(1));
    expect(locked.body.error.code).toBe('ROUTE_NOT_EDITABLE');
  });

  it('shows history, events and statistics', async () => {
    const list = await alice.req<RouteSummaryDto[]>('GET', '/api/routes');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ deliveriesTotal: 6, deliveriesDone: 1, deliveriesFailed: 1, status: 'completed' });
    const events = await alice.req<{ type: string }[]>('GET', `/api/routes/${routeId}/events`);
    const types = events.body.map((e) => e.type);
    for (const t of ['route_created', 'route_optimized', 'route_started', 'delivery_completed', 'delivery_added', 'route_recalculated', 'delivery_failed', 'route_completed']) {
      expect(types).toContain(t);
    }
    const stats = await alice.req<StatsDto>('GET', '/api/stats');
    expect(stats.body).toMatchObject({ routes: 1, deliveriesDone: 1, deliveriesFailed: 1, successRate: 0.5 });
    expect(stats.body.savedFuelL).toBeNull(); // no consumption configured → no invented fuel number
    // savings are fixed at planning time; the mid-route recalculation must not inflate them
    expect(stats.body.savedDistanceKm * 1000).toBeCloseTo(plannedSavingsM, 0);
  });

  it('isolates data between users', async () => {
    const bob = new Client(app);
    await bob.req('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'segredo-456' });
    expect((await bob.req('GET', `/api/routes/${routeId}`)).status).toBe(404);
    expect((await bob.req('DELETE', `/api/routes/${routeId}`)).status).toBe(404);
    expect((await bob.req<RouteSummaryDto[]>('GET', '/api/routes')).body).toHaveLength(0);
    const anon = new Client(app);
    expect((await anon.req('GET', '/api/routes')).status).toBe(401);
  });

  it('purges personal data after the retention period but keeps aggregates', async () => {
    const future = new Date(Date.now() + 400 * 86_400_000);
    const purged = await purgeExpiredPersonalData(deps.db, 90, future);
    expect(purged).toBe(1);
    const route = (await alice.req<RouteDto>('GET', `/api/routes/${routeId}`)).body;
    expect(route.piiPurged).toBe(true);
    expect(route.deliveries.every((d) => d.recipientName === null && d.lat === null)).toBe(true);
    expect(route.plannedDistanceM).toBeGreaterThan(0);
    const [row] = await deps.db.select().from(routes).where(eq(routes.id, routeId));
    expect(row.startLat).toBeNull();
  });

  it('deletes all route history on request', async () => {
    const r = await alice.req<{ deleted: number }>('DELETE', '/api/me/routes');
    expect(r.body.deleted).toBe(1);
    expect((await alice.req<RouteSummaryDto[]>('GET', '/api/routes')).body).toHaveLength(0);
  });
});

describe('label recognition (API)', () => {
  it('parses OCR text without AI and geocodes it', async () => {
    const deps = await testDeps();
    const app = await buildApp(deps);
    const c = new Client(app);
    await c.req('POST', '/api/auth/register', { name: 'Carol', email: 'carol@example.com', password: 'segredo-789' });
    const r = await c.req<RecognitionResult>('POST', '/api/recognition/text', {
      text: 'DESTINATARIO\nJuan García\nC/ San Migel 15, 2ºB\n29620 Torremolino (Málaga)',
      ocrConfidence: 82,
    });
    expect(r.status).toBe(200);
    expect(r.body.usedAi).toBe(false);
    expect(r.body.fields).toMatchObject({ recipientName: 'Juan García', number: '15', complement: '2ºB', postalCode: '29620' });
    expect(r.body.geocode?.best?.street).toBe('Calle San Miguel');
    expect(r.body.geocode?.best?.corrections.length).toBeGreaterThan(0);

    const img = await c.req<{ error: { code: string } }>('POST', '/api/recognition/image', { imageBase64: 'A'.repeat(200), mimeType: 'image/jpeg' });
    expect(img.body.error.code).toBe('AI_IMAGES_DISABLED');
    await app.close();
    await deps.close();
  });

  it('calls the AI (text only) when the rule-based parse is not confident', async () => {
    const calls: string[] = [];
    const fakeAi: AiProvider = {
      name: 'fake-ai',
      supportsImages: true,
      async interpretText(text) {
        calls.push(text);
        return {
          fields: { recipientName: 'Ana Silva', phone: null, street: 'Calle San Miguel', number: '15', complement: null, postalCode: '29620', city: 'Torremolinos', province: 'Málaga', country: 'ES', notes: null },
          confidence: 0.9,
        };
      },
      async interpretImage() {
        throw new Error('should not be called');
      },
    };
    const deps = await testDeps({ ai: fakeAi });
    const app = await buildApp(deps);
    const c = new Client(app);
    await c.req('POST', '/api/auth/register', { name: 'Dan', email: 'dan@example.com', password: 'segredo-000' });
    const r = await c.req<RecognitionResult>('POST', '/api/recognition/text', { text: 'ana silva sn mgl quince torremolinos', ocrConfidence: 40 });
    expect(calls).toHaveLength(1);
    expect(r.body.usedAi).toBe(true);
    expect(r.body.aiProvider).toBe('fake-ai');
    expect(r.body.fields.street).toBe('Calle San Miguel');
    await app.close();
    await deps.close();
  });
});
