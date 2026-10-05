import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v === 'true' || v === '1'));

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Postgres connection string. Empty → embedded PGlite in PGLITE_DIR (development). */
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('./.data/pglite'),

  /** 32 bytes, base64. Encrypts personal fields (recipient, phone, notes). REQUIRED in production. */
  DATA_ENCRYPTION_KEY: z.string().optional(),
  CORS_ORIGINS: list,
  COOKIE_SECURE: bool,
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Serve the built web app (apps/web/dist) from the API — single-process deploy. */
  SERVE_WEB_DIST: z.string().optional(),

  // ---- maps ----
  MAP_PROVIDER: z.enum(['osrm', 'valhalla', 'google']).default('osrm'),
  GEOCODING_PROVIDERS: list,
  OSRM_URL: z.string().url().default('https://router.project-osrm.org'),
  OSRM_BIKE_URL: z.string().url().default('https://routing.openstreetmap.de/routed-bike'),
  OSRM_MAX_TABLE_SIZE: z.coerce.number().int().min(2).default(100),
  VALHALLA_URL: z.string().url().default('https://valhalla1.openstreetmap.de'),
  VALHALLA_MAX_MATRIX_LOCATIONS: z.coerce.number().int().min(2).default(50),
  CARTOCIUDAD_URL: z.string().url().default('https://www.cartociudad.es/geocoder/api/geocoder'),
  NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  /** Nominatim usage policy requires an identifying User-Agent with contact. */
  NOMINATIM_USER_AGENT: z.string().default('derepart/0.1 (self-hosted delivery planner)'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  GOOGLE_TRAFFIC_AWARE: bool,
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),

  // ---- optimisation ----
  OPTIMIZER_TIME_LIMIT_MS: z.coerce.number().int().min(100).max(30000).default(1500),

  // ---- AI ----
  AI_PROVIDER: z.enum(['none', 'anthropic', 'openai']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),

  // ---- privacy ----
  RETENTION_DEFAULT_DAYS: z.coerce.number().int().min(1).default(90),
  RETENTION_SWEEP_MINUTES: z.coerce.number().int().min(1).default(360),
});

export type AppConfig = z.infer<typeof envSchema> & {
  geocoders: string[];
  isProd: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // `KEY=` in .env means "not set": drop empty strings so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida no .env:\n${issues}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === 'production';
  if (isProd && !c.DATA_ENCRYPTION_KEY) {
    throw new Error('DATA_ENCRYPTION_KEY é obrigatório em produção (gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))")');
  }
  if (c.MAP_PROVIDER === 'google' && !c.GOOGLE_MAPS_API_KEY) {
    throw new Error('MAP_PROVIDER=google exige GOOGLE_MAPS_API_KEY no .env do backend');
  }
  const defaultGeocoders = c.MAP_PROVIDER === 'google' ? ['google'] : ['cartociudad', 'nominatim'];
  return {
    ...c,
    COOKIE_SECURE: c.COOKIE_SECURE ?? isProd,
    GOOGLE_TRAFFIC_AWARE: c.GOOGLE_TRAFFIC_AWARE ?? true,
    geocoders: c.GEOCODING_PROVIDERS.length ? c.GEOCODING_PROVIDERS : defaultGeocoders,
    isProd,
  };
}
