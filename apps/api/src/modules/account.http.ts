import { loginSchema, registerSchema, savedPlaceSchema, settingsSchema, vehicleSchema, type SavedPlaceDto } from '@derepart/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService, CSRF_HEADER, requireAuth, SESSION_COOKIE, setSessionCookie } from '../auth/auth';
import type { AppDeps } from '../context';
import { savedPlaces, userSettings, vehicles } from '../db/schema';
import { AppError } from '../lib/errors';
import { toVehicleDto } from './mappers';
import type { RoutesService } from './routes/routes.service';

const idParams = z.object({ id: z.uuid() });
const authLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

/** The web app relies on the httpOnly cookie; only a native client receives the bearer token. */
const nativeToken = (headers: Record<string, unknown>, token: string) =>
  headers[CSRF_HEADER] === 'native' ? { token } : {};

export function accountHttp(app: FastifyInstance, deps: AppDeps, routesService: RoutesService) {
  const auth = new AuthService(deps);
  const { db, config } = deps;

  // ---- auth (local mode; with Supabase Auth the app talks to Supabase directly) ----
  const localOnly = () => {
    if (auth.mode !== 'local') {
      throw new AppError('FORBIDDEN', undefined, { message: 'O login é feito pelo Supabase. Atualize o app.' });
    }
  };

  app.post('/api/auth/register', { config: authLimit }, async (req, reply) => {
    localOnly();
    const input = registerSchema.parse(req.body);
    const s = await auth.register(input, req.headers['user-agent'] ?? null);
    setSessionCookie(reply, s.token, s.expiresAt, config.COOKIE_SECURE ?? false);
    reply.status(201);
    const ctx = await auth.resolve(s.token);
    return { ...(await auth.me(ctx!)), ...nativeToken(req.headers, s.token) };
  });

  app.post('/api/auth/login', { config: authLimit }, async (req, reply) => {
    localOnly();
    const input = loginSchema.parse(req.body);
    const s = await auth.login(input, req.headers['user-agent'] ?? null);
    setSessionCookie(reply, s.token, s.expiresAt, config.COOKIE_SECURE ?? false);
    const ctx = await auth.resolve(s.token);
    return { ...(await auth.me(ctx!)), ...nativeToken(req.headers, s.token) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) await auth.logout(req.auth);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/api/me', async (req) => auth.me(requireAuth(req)));

  /** Deletes the account and all its data (routes, deliveries, events, vehicles, places). */
  app.delete('/api/me', async (req, reply) => {
    const ctx = requireAuth(req);
    await auth.deleteAccount(ctx);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  /** Deletes the route history, keeping the account and settings. */
  app.delete('/api/me/routes', async (req) => {
    const ctx = requireAuth(req);
    return { deleted: await routesService.deleteAllRoutes(ctx) };
  });

  app.put('/api/me/settings', async (req) => {
    const ctx = requireAuth(req);
    const s = settingsSchema.parse(req.body);
    await db
      .insert(userSettings)
      .values({ userId: ctx.userId, ...s })
      .onConflictDoUpdate({ target: userSettings.userId, set: s });
    return (await auth.me(ctx)).settings;
  });

  // ---- vehicles ----
  app.get('/api/vehicles', async (req) => {
    const ctx = requireAuth(req);
    const rows = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.orgId, ctx.orgId), eq(vehicles.userId, ctx.userId)))
      .orderBy(asc(vehicles.createdAt));
    return rows.map(toVehicleDto);
  });

  app.post('/api/vehicles', async (req, reply) => {
    const ctx = requireAuth(req);
    const v = vehicleSchema.parse(req.body);
    const row = await db.transaction(async (tx) => {
      if (v.isDefault) {
        await tx.update(vehicles).set({ isDefault: false }).where(and(eq(vehicles.orgId, ctx.orgId), eq(vehicles.userId, ctx.userId)));
      }
      const [r] = await tx.insert(vehicles).values({ ...v, orgId: ctx.orgId, userId: ctx.userId }).returning();
      return r;
    });
    reply.status(201);
    return toVehicleDto(row);
  });

  app.put('/api/vehicles/:id', async (req) => {
    const ctx = requireAuth(req);
    const { id } = idParams.parse(req.params);
    const v = vehicleSchema.parse(req.body);
    const row = await db.transaction(async (tx) => {
      if (v.isDefault) {
        await tx.update(vehicles).set({ isDefault: false }).where(and(eq(vehicles.orgId, ctx.orgId), eq(vehicles.userId, ctx.userId)));
      }
      const [r] = await tx
        .update(vehicles)
        .set(v)
        .where(and(eq(vehicles.id, id), eq(vehicles.orgId, ctx.orgId), eq(vehicles.userId, ctx.userId)))
        .returning();
      return r;
    });
    if (!row) throw new AppError('NOT_FOUND');
    return toVehicleDto(row);
  });

  app.delete('/api/vehicles/:id', async (req, reply) => {
    const ctx = requireAuth(req);
    const { id } = idParams.parse(req.params);
    await db.delete(vehicles).where(and(eq(vehicles.id, id), eq(vehicles.orgId, ctx.orgId), eq(vehicles.userId, ctx.userId)));
    return reply.status(204).send();
  });

  // ---- saved places (start points) ----
  app.get('/api/places', async (req): Promise<SavedPlaceDto[]> => {
    const ctx = requireAuth(req);
    const rows = await db
      .select()
      .from(savedPlaces)
      .where(and(eq(savedPlaces.orgId, ctx.orgId), eq(savedPlaces.userId, ctx.userId)))
      .orderBy(asc(savedPlaces.label));
    return rows.map((p) => ({ id: p.id, label: p.label, address: p.address, lat: p.lat, lng: p.lng }));
  });

  app.post('/api/places', async (req, reply) => {
    const ctx = requireAuth(req);
    const p = savedPlaceSchema.parse(req.body);
    const [row] = await db.insert(savedPlaces).values({ ...p, orgId: ctx.orgId, userId: ctx.userId }).returning();
    reply.status(201);
    return { id: row.id, label: row.label, address: row.address, lat: row.lat, lng: row.lng };
  });

  app.delete('/api/places/:id', async (req, reply) => {
    const ctx = requireAuth(req);
    const { id } = idParams.parse(req.params);
    await db.delete(savedPlaces).where(and(eq(savedPlaces.id, id), eq(savedPlaces.orgId, ctx.orgId), eq(savedPlaces.userId, ctx.userId)));
    return reply.status(204).send();
  });

  return auth;
}
