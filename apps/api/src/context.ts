import type { AppConfig } from './config';
import type { Db } from './db/client';
import type { FieldCipher } from './lib/crypto';
import type { AiProvider } from './providers/ai/types';
import type { MapProvider } from './providers/maps/types';
import type { TokenVerifier } from './auth/supabase';

/** Dependencies shared by all modules (injected → easy to fake in tests). */
export interface AppDeps {
  config: AppConfig;
  db: Db;
  cipher: FieldCipher;
  maps: MapProvider;
  ai: AiProvider;
  /** Supabase token verifier; built from SUPABASE_URL when not injected (tests inject one). */
  tokenVerifier?: TokenVerifier | null;
}

/** Authenticated caller. Every data access is scoped by these ids. */
export interface AuthContext {
  userId: string;
  orgId: string;
  sessionId: string;
}
