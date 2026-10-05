import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AuthService, registerAuth } from './auth/auth';
import type { AppDeps } from './context';
import { AppError, errorHandler } from './lib/errors';
import { accountHttp } from './modules/account.http';
import { geoHttp } from './modules/geo.http';
import { recognitionHttp } from './modules/recognition/recognition.http';
import { routesHttp } from './modules/routes/routes.http';
import { statsHttp } from './modules/stats.http';

export async function buildApp(deps: AppDeps, opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    // label photos for AI are sent as base64 (≈2 MB max)
    bodyLimit: 3 * 1024 * 1024,
    trustProxy: true,
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: new AppError('NOT_FOUND').message } });
    return reply.status(404).send();
  });

  await app.register(helmet, {
    // The API serves JSON; when it also serves the PWA, the CSP must allow map tiles/OCR assets.
    contentSecurityPolicy: deps.config.SERVE_WEB_DIST
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'blob:', 'https://cdn.jsdelivr.net'],
            workerSrc: ["'self'", 'blob:'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            connectSrc: ["'self'", 'https:', 'blob:', 'data:'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          },
        }
      : false,
  });
  await app.register(cookie);
  // before rate limiting, so authenticated callers are limited per user instead of per IP
  registerAuth(app, new AuthService(deps));
  if (deps.config.CORS_ORIGINS.length) {
    await app.register(cors, { origin: deps.config.CORS_ORIGINS, credentials: true });
  }
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.auth?.userId ?? req.ip,
    errorResponseBuilder: () => {
      const e = new AppError('RATE_LIMITED');
      return Object.assign(e, { statusCode: 429 });
    },
  });

  app.get('/api/health', async () => ({ ok: true }));
  const routesService = routesHttp(app, deps);
  accountHttp(app, deps, routesService);
  geoHttp(app, deps);
  recognitionHttp(app, deps);
  statsHttp(app, deps);

  const webDist = deps.config.SERVE_WEB_DIST ? path.resolve(deps.config.SERVE_WEB_DIST) : null;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    // SPA fallback
    app.get('/*', (req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send();
      return reply.sendFile('index.html');
    });
  }

  return app;
}
