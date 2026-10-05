import {
  completeRouteSchema,
  createDeliverySchema,
  createRouteSchema,
  optimizeRouteSchema,
  submitEventsSchema,
  updateDeliverySchema,
  updateRouteSchema,
  OPTIMIZATION_MODES,
} from '@derepart/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/auth';
import type { AppDeps } from '../../context';
import { RoutesService } from './routes.service';

const idParams = z.object({ id: z.uuid() });
const deliveryParams = z.object({ id: z.uuid(), deliveryId: z.uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined)),
});

export function routesHttp(app: FastifyInstance, deps: AppDeps) {
  const service = new RoutesService(deps);
  const optimizeLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  app.get('/api/routes', async (req) => {
    const ctx = requireAuth(req);
    return service.listRoutes(ctx, listQuery.parse(req.query));
  });

  app.get('/api/routes/active', async (req) => {
    const ctx = requireAuth(req);
    return { route: await service.getActiveRoute(ctx) };
  });

  app.post('/api/routes', async (req, reply) => {
    const ctx = requireAuth(req);
    const input = createRouteSchema.parse(req.body);
    const mode = input.optimizationMode ?? OPTIMIZATION_MODES[2];
    reply.status(201);
    return service.createRoute(ctx, { ...input, optimizationMode: mode });
  });

  app.get('/api/routes/:id', async (req) => {
    const ctx = requireAuth(req);
    return service.getRoute(ctx, idParams.parse(req.params).id);
  });

  app.patch('/api/routes/:id', async (req) => {
    const ctx = requireAuth(req);
    return service.updateRoute(ctx, idParams.parse(req.params).id, updateRouteSchema.parse(req.body));
  });

  app.delete('/api/routes/:id', async (req, reply) => {
    const ctx = requireAuth(req);
    await service.deleteRoute(ctx, idParams.parse(req.params).id);
    return reply.status(204).send();
  });

  app.post('/api/routes/:id/deliveries', async (req, reply) => {
    const ctx = requireAuth(req);
    reply.status(201);
    return service.addDelivery(ctx, idParams.parse(req.params).id, createDeliverySchema.parse(req.body));
  });

  app.patch('/api/routes/:id/deliveries/:deliveryId', async (req) => {
    const ctx = requireAuth(req);
    const p = deliveryParams.parse(req.params);
    return service.updateDelivery(ctx, p.id, p.deliveryId, updateDeliverySchema.parse(req.body));
  });

  app.delete('/api/routes/:id/deliveries/:deliveryId', async (req) => {
    const ctx = requireAuth(req);
    const p = deliveryParams.parse(req.params);
    return service.removeDelivery(ctx, p.id, p.deliveryId);
  });

  app.post('/api/routes/:id/optimize', { config: optimizeLimit }, async (req) => {
    const ctx = requireAuth(req);
    return service.optimize(ctx, idParams.parse(req.params).id, optimizeRouteSchema.parse(req.body ?? {}));
  });

  app.post('/api/routes/:id/start', async (req) => {
    const ctx = requireAuth(req);
    return service.startRoute(ctx, idParams.parse(req.params).id);
  });

  app.post('/api/routes/:id/events', async (req) => {
    const ctx = requireAuth(req);
    const { events } = submitEventsSchema.parse(req.body);
    return service.applyEvents(ctx, idParams.parse(req.params).id, events);
  });

  app.get('/api/routes/:id/events', async (req) => {
    const ctx = requireAuth(req);
    return service.listEvents(ctx, idParams.parse(req.params).id);
  });

  app.post('/api/routes/:id/complete', async (req) => {
    const ctx = requireAuth(req);
    return service.completeRoute(ctx, idParams.parse(req.params).id, completeRouteSchema.parse(req.body ?? {}));
  });

  return service;
}
