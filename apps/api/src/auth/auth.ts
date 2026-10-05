import type { LoginInput, MeDto, RegisterInput, SettingsDto, NavApp, OptimizationMode } from '@derepart/shared';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps, AuthContext } from '../context';
import { memberships, organizations, sessions, users, userSettings, vehicles } from '../db/schema';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { AppError } from '../lib/errors';

export const SESSION_COOKIE = 'derepart_session';
/** Required on cookie-authenticated mutations: a cross-site form cannot set custom headers. */
export const CSRF_HEADER = 'x-derepart-client';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

// A real hash, so login timing is similar whether or not the e-mail exists.
let dummyHash: Promise<string> | null = null;

export class AuthService {
  constructor(private readonly deps: AppDeps) {}

  async register(input: RegisterInput, userAgent: string | null) {
    const { db, config } = this.deps;
    const [exists] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`);
    if (exists) throw new AppError('EMAIL_TAKEN');
    const passwordHash = await hashPassword(input.password);
    const { userId, orgId } = await db.transaction(async (tx) => {
      const [org] = await tx.insert(organizations).values({ name: `Pessoal — ${input.name}` }).returning();
      const [user] = await tx.insert(users).values({ name: input.name, email: input.email, passwordHash }).returning();
      await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: 'owner' });
      await tx.insert(userSettings).values({ userId: user.id, retentionDays: config.RETENTION_DEFAULT_DAYS });
      // Consumption/price left empty on purpose: no fuel estimate until the user enters real values.
      await tx.insert(vehicles).values({ orgId: org.id, userId: user.id, name: 'Meu veículo', type: 'car', isDefault: true });
      return { userId: user.id, orgId: org.id };
    });
    return this.createSession(userId, orgId, userAgent);
  }

  async login(input: LoginInput, userAgent: string | null) {
    const { db } = this.deps;
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`);
    if (!user) {
      dummyHash ??= hashPassword('timing-equaliser');
      await verifyPassword(input.password, await dummyHash);
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) throw new AppError('INVALID_CREDENTIALS');
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
    if (!m) throw new AppError('FORBIDDEN');
    return this.createSession(user.id, m.orgId, userAgent);
  }

  private async createSession(userId: string, orgId: string, userAgent: string | null) {
    const token = randomToken();
    const ttlMs = this.deps.config.SESSION_TTL_DAYS * 86_400_000;
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.deps.db.insert(sessions).values({
      userId,
      orgId,
      tokenHash: sha256(token),
      userAgent: userAgent?.slice(0, 200) ?? null,
      expiresAt,
    });
    return { token, expiresAt };
  }

  async resolve(token: string): Promise<AuthContext | null> {
    const { db, config } = this.deps;
    const [s] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
    if (!s) return null;
    // Sliding expiration, written at most once per hour.
    if (Date.now() - s.lastSeenAt.getTime() > 3_600_000) {
      await db
        .update(sessions)
        .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000) })
        .where(eq(sessions.id, s.id));
    }
    return { userId: s.userId, orgId: s.orgId, sessionId: s.id };
  }

  async logout(ctx: AuthContext) {
    await this.deps.db.delete(sessions).where(eq(sessions.id, ctx.sessionId));
  }

  async purgeExpiredSessions() {
    await this.deps.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }

  async me(ctx: AuthContext): Promise<MeDto> {
    const { db } = this.deps;
    const [user] = await db.select().from(users).where(eq(users.id, ctx.userId));
    if (!user) throw new AppError('UNAUTHENTICATED');
    const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, ctx.userId));
    const settings: SettingsDto = {
      defaultMode: (s?.defaultMode ?? 'balanced') as OptimizationMode,
      navApp: (s?.navApp ?? 'google') as NavApp,
      serviceTimeS: s?.serviceTimeS ?? 180,
      allowAiImages: s?.allowAiImages ?? false,
      retentionDays: s?.retentionDays ?? this.deps.config.RETENTION_DEFAULT_DAYS,
    };
    return {
      user: { id: user.id, name: user.name, email: user.email, orgId: ctx.orgId, createdAt: user.createdAt.toISOString() },
      settings,
    };
  }

  /** Deletes the account. Org rows cascade when the user was its only member. */
  async deleteAccount(ctx: AuthContext) {
    const { db } = this.deps;
    await db.transaction(async (tx) => {
      const members = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.orgId, ctx.orgId));
      await tx.delete(users).where(eq(users.id, ctx.userId));
      if (members.length <= 1) await tx.delete(organizations).where(eq(organizations.id, ctx.orgId));
    });
  }
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, secure: boolean) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: expiresAt,
  });
}

/**
 * Resolves the session from the httpOnly cookie (web) or `Authorization: Bearer` (native app).
 */
export function registerAuth(app: FastifyInstance, service: AuthService) {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const cookie = req.cookies?.[SESSION_COOKIE] ?? null;
    const token = bearer ?? cookie;
    if (!token) return;
    req.auth = await service.resolve(token);
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (req.auth && !bearer && mutating && !req.headers[CSRF_HEADER]) {
      throw new AppError('FORBIDDEN', undefined, { message: 'Requisição bloqueada (CSRF).' });
    }
  });
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHENTICATED');
  return req.auth;
}
