import { existsSync, mkdirSync } from 'node:fs';
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
const MIGRATIONS_DIR =
  [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')].find((d) => existsSync(path.join(d, 'meta/_journal.json'))) ??
  path.resolve(here, '../../drizzle');

/**
 * Opens the database and applies pending migrations.
 * - DATABASE_URL set → node-postgres pool (production, any Postgres incl. Supabase/Neon).
 * - otherwise → PGlite (real Postgres in WASM) persisted in `pgliteDir`, or in memory for tests.
 */
export async function openDatabase(opts: {
  databaseUrl?: string;
  pgliteDir?: string | 'memory';
  migrationsDir?: string;
}): Promise<DbHandle> {
  const migrationsFolder = opts.migrationsDir ?? MIGRATIONS_DIR;

  if (opts.databaseUrl) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
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
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, kind: 'pglite', close: () => client.close() };
}
