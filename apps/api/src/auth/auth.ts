import type { LoginInput, MeDto, NavApp, OptimizationMode, RegisterInput, SettingsDto } from '@derepart/shared';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps, AuthContext } from '../context';
import type { Db } from '../db/client';
import { memberships, organizations, sessions, users, userSettings, vehicles } from '../db/schema';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { AppError } from '../lib/errors';
import type { ExternalIdentity, TokenVerifier } from './supabase';

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

/**
 * Two modes (AUTH_PROVIDER):
 *  - supabase: accounts live in Supabase Auth; the API verifies its JWTs and keeps a profile
 *    (users row with the same id) plus the personal workspace, created on first access.
 *  - local:    e-mail + password stored here (scrypt) and opaque session tokens.
 */
export class AuthService {
  /** userId → orgId of already-provisioned external users (saves a query per request). */
  private readonly provisioned = new Map<string, string>();

  constructor(private readonly deps: AppDeps) {}

  get mode() {
    return this.deps.config.AUTH_PROVIDER;
  }

  /** Organisation, membership, settings and default vehicle of a new user. */
  private async createWorkspace(tx: Db, userId: string, name: string): Promise<string> {
    const [org] = await tx.insert(organizations).values({ name: `Pessoal — ${name}` }).returning();
    await tx.insert(memberships).values({ orgId: org.id, userId, role: 'owner' });
    await tx.insert(userSettings).values({ userId, retentionDays: this.deps.config.RETENTION_DEFAULT_DAYS });
    // Consumption/price left empty on purpose: no fuel estimate until the user enters real values.
    await tx.insert(vehicles).values({ orgId: org.id, userId, name: 'Meu veículo', type: 'car', isDefault: true });
    return org.id;
  }

  // ---- local mode -----------------------------------------------------------

  async register(input: RegisterInput, userAgent: string | null) {
    const { db } = this.deps;
    const [exists] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`);
    if (exists) throw new AppError('EMAIL_TAKEN');
    const passwordHash = await hashPassword(input.password);
    const { userId, orgId } = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const [user] = await tx.insert(users).values({ name: input.name, email: input.email, passwordHash }).returning();
      return { userId: user.id, orgId: await this.createWorkspace(tx, user.id, input.name) };
    });
    return this.createSession(userId, orgId, userAgent);
  }

  async login(input: LoginInput, userAgent: string | null) {
    const { db } = this.deps;
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`);
    if (!user || !user.passwordHash) {
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
    if (this.mode === 'local') await this.deps.db.delete(sessions).where(eq(sessions.id, ctx.sessionId));
  }

  async purgeExpiredSessions() {
    await this.deps.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }

  // ---- supabase mode ---------------------------------------------------------

  /** Returns the user's org, creating profile + workspace on the first request of a new account. */
  async ensureExternalUser(id: ExternalIdentity): Promise<{ userId: string; orgId: string }> {
    const cached = this.provisioned.get(id.userId);
    if (cached) return { userId: id.userId, orgId: cached };
    const { db } = this.deps;
    const find = async () => {
      const [m] = await db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, id.userId)).limit(1);
      return m?.orgId ?? null;
    };
    let orgId = await find();
    if (!orgId) {
      const name = id.name ?? titleFromEmail(id.email);
      await db.transaction(async (txRaw) => {
        const tx = txRaw as unknown as Db;
        // onConflictDoNothing: two first requests in parallel must not create two workspaces
        const inserted = await tx.insert(users).values({ id: id.userId, name, email: id.email, passwordHash: null }).onConflictDoNothing().returning({ id: users.id });
        if (inserted.length) await this.createWorkspace(tx, id.userId, name);
      });
      orgId = await find();
      if (!orgId) throw new AppError('FORBIDDEN', undefined, { message: 'Este e-mail já está ligado a outra conta neste servidor.' });
    }
    this.provisioned.set(id.userId, orgId);
    return { userId: id.userId, orgId };
  }

  // ---- common -----------------------------------------------------------------

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

  /**
   * Deletes the account. Org rows cascade when the user was its only member.
   * In supabase mode the Supabase Auth user is deleted too (the API connects as "postgres").
   */
  async deleteAccount(ctx: AuthContext) {
    const { db } = this.deps;
    await db.transaction(async (tx) => {
      const members = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.orgId, ctx.orgId));
      await tx.delete(users).where(eq(users.id, ctx.userId));
      if (members.length <= 1) await tx.delete(organizations).where(eq(organizations.id, ctx.orgId));
      if (this.mode === 'supabase') await tx.execute(sql`delete from auth.users where id = ${ctx.userId}::uuid`);
    });
    this.provisioned.delete(ctx.userId);
  }
}

function titleFromEmail(email: string) {
  const local = email.split('@')[0] ?? 'Entregador';
  const name = local.replace(/[._-]+/g, ' ').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Entregador';
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
 * supabase mode: `Authorization: Bearer <Supabase access token>`.
 * local mode: httpOnly cookie (web) or `Authorization: Bearer <session token>` (native app).
 */
export function registerAuth(app: FastifyInstance, service: AuthService, verifier: TokenVerifier | null) {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;

    if (service.mode === 'supabase') {
      if (!bearer || !verifier) return;
      const identity = await verifier.verify(bearer);
      if (!identity) return;
      const { userId, orgId } = await service.ensureExternalUser(identity);
      req.auth = { userId, orgId, sessionId: identity.sessionId ?? 'supabase' };
      return; // bearer tokens are not sent automatically by browsers: no CSRF exposure
    }

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
