import type { MeDto, RouteDto } from '@derepart/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { createSupabaseVerifier } from '../auth/supabase';
import { memberships, users } from '../db/schema';
import { testDeps } from './fakes';

const SUPABASE_URL = 'https://projeto-teste.supabase.co';
const USER_ID = '62cb3692-31e5-4073-8764-c7239bcbfd60';

describe('Supabase Auth mode', () => {
  let deps: Awaited<ReturnType<typeof testDeps>>;
  let app: FastifyInstance;
  let sign: (claims?: Record<string, unknown>, opts?: { issuer?: string; exp?: string; sub?: string }) => Promise<string>;

  beforeAll(async () => {
    // Same algorithm as real Supabase projects with asymmetric signing keys (ES256 + JWKS).
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
    sign = (claims = {}, opts = {}) =>
      new SignJWT({ email: 'Tiago@Dezan.me', role: 'authenticated', session_id: 'sess-1', ...claims })
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setIssuer(opts.issuer ?? `${SUPABASE_URL}/auth/v1`)
        .setAudience('authenticated')
        .setSubject(opts.sub ?? USER_ID)
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? '1h')
        .sign(privateKey);

    deps = await testDeps({ env: { SUPABASE_URL } });
    // PGlite has no Supabase "auth" schema: create the bit the API touches.
    await deps.db.execute(sql`create schema if not exists auth`);
    await deps.db.execute(sql`create table if not exists auth.users (id uuid primary key, email text)`);
    await deps.db.execute(sql`insert into auth.users (id, email) values (${USER_ID}::uuid, 'tiago@dezan.me')`);
    app = await buildApp({ ...deps, tokenVerifier: createSupabaseVerifier(SUPABASE_URL, createLocalJWKSet({ keys: [jwk] })) });
  });

  afterAll(async () => {
    await app.close();
    await deps.close();
  });

  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token?: string, payload?: object) =>
    app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('reports the auth mode to the app', async () => {
    const res = await call('GET', '/api/config');
    expect(res.json().authProvider).toBe('supabase');
  });

  it('provisions the profile on first access, reusing the Supabase user id', async () => {
    const token = await sign();
    const res = await call('GET', '/api/me', token);
    expect(res.statusCode).toBe(200);
    const me = res.json() as MeDto;
    expect(me.user).toMatchObject({ id: USER_ID, email: 'tiago@dezan.me', name: 'Tiago' });
    expect(me.settings.defaultMode).toBe('balanced');
  });

  it('does not create a second workspace on later (or parallel) requests', async () => {
    const token = await sign();
    await Promise.all([call('GET', '/api/me', token), call('GET', '/api/vehicles', token), call('GET', '/api/routes', token)]);
    const m = await deps.db.select().from(memberships);
    expect(m.filter((x) => x.userId === USER_ID)).toHaveLength(1);
  });

  it('works for writes with the bearer token (no cookie, no CSRF header needed)', async () => {
    const res = await call('POST', '/api/routes', await sign(), { start: { label: 'Torremolinos', lat: 36.62, lng: -4.5 } });
    expect(res.statusCode).toBe(201);
    expect((res.json() as RouteDto).status).toBe('draft');
  });

  it('uses the name from Supabase user metadata for new accounts', async () => {
    const other = '11111111-2222-4333-8444-555555555555';
    const res = await call('GET', '/api/me', await sign({ email: 'ana@exemplo.es', user_metadata: { name: 'Ana Silva' } }, { sub: other }));
    expect((res.json() as MeDto).user.name).toBe('Ana Silva');
  });

  it('rejects expired, foreign and tampered tokens', async () => {
    expect((await call('GET', '/api/me', await sign({}, { exp: '-1m' }))).statusCode).toBe(401);
    expect((await call('GET', '/api/me', await sign({}, { issuer: 'https://outro.supabase.co/auth/v1' }))).statusCode).toBe(401);
    const token = await sign();
    expect((await call('GET', '/api/me', token.slice(0, -4) + 'AAAA')).statusCode).toBe(401);
    expect((await call('GET', '/api/me', await sign({ role: 'anon' }))).statusCode).toBe(401);
    expect((await call('GET', '/api/me')).statusCode).toBe(401);
  });

  it('disables the local e-mail/password endpoints', async () => {
    const res = await call('POST', '/api/auth/login', undefined, { email: 'tiago@dezan.me', password: 'x' });
    expect(res.statusCode).toBe(403);
    const reg = await call('POST', '/api/auth/register', undefined, { name: 'X', email: 'x@y.com', password: '12345678' });
    expect(reg.statusCode).toBe(403);
  });

  it('deleting the account also deletes the Supabase Auth user', async () => {
    const res = await call('DELETE', '/api/me', await sign());
    expect(res.statusCode).toBe(204);
    expect(await deps.db.select().from(users).where(sql`${users.id} = ${USER_ID}::uuid`)).toHaveLength(0);
    const left = await deps.db.execute(sql`select count(*)::int as n from auth.users where id = ${USER_ID}::uuid`);
    expect((((left as unknown as { rows: { n: number }[] }).rows ?? left) as { n: number }[])[0].n).toBe(0);
  });
});
