import { AppError } from './errors';

export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  /** Retries on network errors / 5xx (not on 4xx). */
  retries?: number;
  provider: string;
}

/**
 * fetch + JSON with timeout, retry and mapping of provider failures to user-facing codes.
 * The technical detail stays in `cause` (logged), never in the response.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (res.status === 429) {
        throw new AppError('PROVIDER_QUOTA', undefined, { cause: `${opts.provider} 429` });
      }
      if (res.status === 401 || res.status === 403) {
        const text = await res.text().catch(() => '');
        throw new AppError('PROVIDER_NOT_CONFIGURED', undefined, { cause: `${opts.provider} ${res.status} ${text.slice(0, 300)}` });
      }
      if (res.status >= 500) {
        lastErr = new AppError('PROVIDER_UNAVAILABLE', undefined, { cause: `${opts.provider} ${res.status}` });
        continue;
      }
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AppError('PROVIDER_UNAVAILABLE', undefined, { cause: `${opts.provider} invalid JSON (${res.status}): ${text.slice(0, 200)}` });
      }
      if (!res.ok) {
        // Most engines answer 400 with a JSON body describing e.g. "NoRoute"; the caller decides.
        throw new ProviderHttpError(res.status, json, opts.provider);
      }
      return json as T;
    } catch (err) {
      if (err instanceof AppError && err.code !== 'PROVIDER_UNAVAILABLE') throw err;
      if (err instanceof ProviderHttpError) throw err;
      lastErr = err instanceof AppError ? err : new AppError('PROVIDER_UNAVAILABLE', undefined, { cause: err });
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastErr;
}

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly provider: string,
  ) {
    super(`${provider} HTTP ${status}`);
  }
}

/** Serialises calls so that at most one runs per `intervalMs` (e.g. Nominatim: 1 req/s). */
export class Throttle {
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly intervalMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.last + this.intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/** Small in-memory TTL cache (geocoding results of public providers). */
export class TtlCache<V> {
  private readonly map = new Map<string, { v: V; exp: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 2000,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.v;
  }

  set(key: string, v: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { v, exp: Date.now() + this.ttlMs });
  }
}
