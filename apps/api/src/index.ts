import path from 'node:path';
import { buildApp } from './app';
import { loadConfig } from './config';
import { dbOptions, openDatabase } from './db/client';
import { FieldCipher, resolveDevKey } from './lib/crypto';
import { createAiProvider } from './providers/ai';
import { createMapProvider } from './providers/maps';
import { purgeExpiredPersonalData } from './services/retention';
import { AuthService } from './auth/auth';

async function main() {
  const config = loadConfig();
  const dataDir = path.dirname(path.resolve(config.PGLITE_DIR));
  const handle = await openDatabase(dbOptions(config));
  const cipher = new FieldCipher(config.DATA_ENCRYPTION_KEY ?? resolveDevKey(dataDir));

  const logger = { level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] };
  const bootLog = { warn: (o: unknown, m?: string) => console.warn(m ?? o, m ? o : '') };
  const maps = createMapProvider(config, bootLog);
  const ai = createAiProvider(config, { warn: (m) => console.warn(m) });
  const deps = { config, db: handle.db, cipher, maps, ai };
  const app = await buildApp(deps, { logger });

  const sweep = async () => {
    try {
      const purged = await purgeExpiredPersonalData(handle.db, config.RETENTION_DEFAULT_DAYS);
      await new AuthService(deps).purgeExpiredSessions();
      if (purged) app.log.info({ purged }, 'retention: personal data removed from old routes');
    } catch (err) {
      app.log.error({ err }, 'retention sweep failed');
    }
  };
  await sweep();
  const timer = setInterval(sweep, config.RETENTION_SWEEP_MINUTES * 60_000);
  timer.unref();

  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(
    { db: handle.kind, maps: maps.routingName, geocoders: maps.geocoderNames, ai: ai.name ?? 'none' },
    'derepart API ready',
  );

  const shutdown = async () => {
    clearInterval(timer);
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
