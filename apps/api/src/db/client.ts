import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close: () => Promise<void>;
}

// src/db/client.ts (dev, tsx) → ../../drizzle ; dist/*.js (bundled) → ../drizzle
const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR =
  [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')].find((d) => existsSync(path.join(d, 'meta/_journal.json'))) ??
  path.resolve(here, '../../drizzle');

/**
 * Opens the database and applies pending migrations.
 * - DATABASE_URL set → node-postgres pool (production, any Postgres incl. Supabase/Neon).
 * - otherwise → PGlite (real Postgres in WASM) persisted in `pgliteDir`, or in memory for tests.
 */
export type DatabaseSsl = 'auto' | 'disable' | 'require' | 'verify';

/**
 * TLS for node-postgres. Supabase/Neon require TLS:
 *  - require → encrypted, server certificate not validated (works with Supabase out of the box)
 *  - verify  → encrypted and validated against DATABASE_CA_CERT (Supabase: Settings → Database → SSL)
 *  - auto    → disable for localhost, require otherwise
 */
function sslOptions(url: URL, mode: DatabaseSsl, caCertPath?: string) {
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const effective = mode === 'auto' ? (local ? 'disable' : 'require') : mode;
  if (effective === 'disable') return false;
  if (effective === 'verify') {
    if (!caCertPath) throw new Error('DATABASE_SSL=verify exige DATABASE_CA_CERT (caminho do certificado CA)');
    return { rejectUnauthorized: true, ca: readFileSync(caCertPath, 'utf8') };
  }
  return { rejectUnauthorized: false };
}

export async function openDatabase(opts: {
  databaseUrl?: string;
  databaseSsl?: DatabaseSsl;
  databaseCaCert?: string;
  pgliteDir?: string | 'memory';
  migrationsDir?: string;
}): Promise<DbHandle> {
  const migrationsFolder = opts.migrationsDir ?? MIGRATIONS_DIR;

  if (opts.databaseUrl) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const url = new URL(opts.databaseUrl);
    // SSL params in the URL would override the options below (pg treats sslmode=require as
    // verify-full, which rejects Supabase's certificate chain), so TLS is set only here.
    for (const p of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(p);
    const pool = new pg.Pool({
      connectionString: url.toString(),
      ssl: sslOptions(url, opts.databaseSsl ?? 'auto', opts.databaseCaCert),
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    // Poolers (Supabase/PgBouncer) may close idle connections: log instead of crashing.
    pool.on('error', (err) => console.warn('postgres idle client error:', err.message));
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    return { db: db as unknown as Db, kind: 'postgres', close: () => pool.end() };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  let client: InstanceType<typeof PGlite>;
  if (!opts.pgliteDir || opts.pgliteDir === 'memory') {
    client = new PGlite();
  } else {
    mkdirSync(opts.pgliteDir, { recursive: true });
    client = new PGlite(opts.pgliteDir);
  }
  const db = drizzle(client, { schema });
  try {
    await migrate(db, { migrationsFolder });
  } catch (err) {
    if (/failed to initialize/i.test(String((err as Error & { cause?: Error }).cause?.message ?? err))) {
      throw new Error(
        `Não foi possível abrir o banco local (${opts.pgliteDir}). Ou outra API está usando o banco (o PGlite aceita um processo por vez), ` +
          'ou ficou um lock antigo de um processo encerrado à força. Com nenhuma API rodando, apague o arquivo postmaster.pid dessa pasta e tente de novo.',
      );
    }
    throw err;
  }
  return { db: db as unknown as Db, kind: 'pglite', close: () => client.close() };
}

/** openDatabase options from the app config (shared by the server and the scripts). */
export function dbOptions(config: { DATABASE_URL?: string; DATABASE_SSL: DatabaseSsl; DATABASE_CA_CERT?: string; PGLITE_DIR: string }) {
  return {
    databaseUrl: config.DATABASE_URL,
    databaseSsl: config.DATABASE_SSL,
    databaseCaCert: config.DATABASE_CA_CERT,
    pgliteDir: config.PGLITE_DIR,
  };
}
