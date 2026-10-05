/**
 * Applies pending migrations (apps/api/drizzle/*.sql) to the configured database and lists
 * the tables, without starting the server:
 *   npm run db:migrate --workspace @derepart/api
 * Do not run the SQL files by hand: drizzle records what was applied in
 * drizzle.__drizzle_migrations and would try to apply them again.
 */
import { sql } from 'drizzle-orm';
import { loadConfig } from '../config';
import { dbOptions, openDatabase } from '../db/client';

async function main() {
  const config = loadConfig();
  const target = config.DATABASE_URL ? new URL(config.DATABASE_URL).host : `PGlite (${config.PGLITE_DIR})`;
  console.log(`Conectando em ${target}…`);
  const handle = await openDatabase(dbOptions(config));
  const res = await handle.db.execute(sql`
    select c.relname as table, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by 1`);
  const rows = (Array.isArray(res) ? res : (res as { rows: { table: string; rls: boolean }[] }).rows) as { table: string; rls: boolean }[];
  console.log('Migrações aplicadas. Tabelas:');
  for (const r of rows) console.log(`  ${r.table.padEnd(16)} RLS ${r.rls ? 'ativo' : 'DESATIVADO'}`);
  await handle.close();
}

main().catch((err) => {
  console.error('Falha:', err?.message ?? err, err?.cause?.message ? `\n  causa: ${err.cause.message}` : '');
  process.exit(1);
});
