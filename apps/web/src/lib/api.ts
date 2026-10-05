import { messageFor, type ErrorCode } from '@derepart/shared';
import { accessToken } from './supabase';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Error shown to the user: always a friendly message, never the technical one. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly status = 0,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? messageFor(code));
  }
}

let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    // Supabase Auth: the access token goes as Bearer. Local auth: httpOnly cookie.
    const token = await accessToken();
    res = await fetch(`${BASE}/api${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Derepart-Client': 'web',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('OFFLINE');
  }
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON (proxy error page, etc.)
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: ErrorCode; message?: string; details?: Record<string, unknown> } })?.error;
    // A dev proxy without the API running answers 502/504 → treat as unavailable
    const code: ErrorCode = e?.code ?? (res.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'INTERNAL');
    if (code === 'UNAUTHENTICATED') onUnauthenticated?.();
    throw new ApiError(code, e?.message, res.status, e?.details);
  }
  return body as T;
}

export const isOffline = (err: unknown) => err instanceof ApiError && err.code === 'OFFLINE';
export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error && err.name === 'AbortError' ? '' : messageFor('INTERNAL');
