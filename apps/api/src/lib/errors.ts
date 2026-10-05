import { ERROR_MESSAGES, type ApiErrorBody, type ErrorCode } from '@derepart/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

const STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION: 400,
  POSTAL_CODE_INVALID: 400,
  NO_DELIVERIES: 400,
  IMAGE_TOO_LARGE: 413,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  AI_IMAGES_DISABLED: 403,
  NOT_FOUND: 404,
  ADDRESS_NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  ROUTE_NOT_EDITABLE: 409,
  ADDRESS_AMBIGUOUS: 409,
  ROUTE_IMPOSSIBLE: 422,
  ROUTE_TOO_LARGE: 422,
  OCR_FAILED: 422,
  AI_FAILED: 502,
  RATE_LIMITED: 429,
  PROVIDER_QUOTA: 503,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_NOT_CONFIGURED: 503,
  AI_NOT_CONFIGURED: 503,
};

/** Error with a user-facing code. `cause` keeps the technical detail for the logs only. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    options?: { cause?: unknown; message?: string },
  ) {
    super(options?.message ?? ERROR_MESSAGES[code], { cause: options?.cause });
  }

  get status(): number {
    return STATUS[this.code] ?? 500;
  }
}

export function errorBody(code: ErrorCode, details?: Record<string, unknown>, message?: string): ApiErrorBody {
  return { error: { code, message: message ?? ERROR_MESSAGES[code], ...(details ? { details } : {}) } };
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    if (err.status >= 500) req.log.warn({ err, cause: err.cause }, `app error ${err.code}`);
    return reply.status(err.status).send(errorBody(err.code, err.details, err.message));
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
    return reply.status(400).send(errorBody('VALIDATION', { fields }));
  }
  const fe = err as FastifyError;
  if (fe.statusCode === 429) return reply.status(429).send(errorBody('RATE_LIMITED'));
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    if (fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.status(413).send(errorBody('IMAGE_TOO_LARGE'));
    return reply.status(fe.statusCode).send(errorBody('VALIDATION'));
  }
  req.log.error({ err }, 'unhandled error');
  return reply.status(500).send(errorBody('INTERNAL'));
}
