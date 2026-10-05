import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../lib/errors';

export interface ExternalIdentity {
  /** Supabase auth.users.id — also used as our users.id. */
  userId: string;
  email: string;
  name: string | null;
  sessionId: string | null;
}

export interface TokenVerifier {
  /** null = invalid/expired token (→ 401). Throws only when the key server is unreachable. */
  verify(token: string): Promise<ExternalIdentity | null>;
}

/**
 * Verifies Supabase Auth access tokens (JWT) with the project's public signing keys (JWKS),
 * so the API needs no Supabase secret. Checks signature, issuer, audience and expiry.
 */
export function createSupabaseVerifier(supabaseUrl: string, keySet?: JWTVerifyGetKey): TokenVerifier {
  const base = supabaseUrl.replace(/\/$/, '');
  const jwks = keySet ?? createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), { cacheMaxAge: 10 * 60_000 });
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer: `${base}/auth/v1`, audience: 'authenticated' });
        if (!payload.sub || payload.role !== 'authenticated' || payload.is_anonymous === true) return null;
        const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
        const name = [meta.name, meta.full_name].find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? null;
        return {
          userId: payload.sub,
          email: typeof payload.email === 'string' ? payload.email.toLowerCase() : '',
          name,
          sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
        };
      } catch (err) {
        if (err instanceof errors.JWKSTimeout || !(err instanceof errors.JOSEError)) {
          throw new AppError('PROVIDER_UNAVAILABLE', undefined, { cause: err, message: 'Não foi possível validar o login agora. Tente novamente.' });
        }
        return null;
      }
    },
  };
}
