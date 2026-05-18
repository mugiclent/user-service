import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { Prisma } from '@prisma/client';

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    if (err.code.startsWith('STEP_UP_')) {
      res.setHeader('x-sudo-required', 'true');
    }
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // body-parser JSON parse failure — malformed request body
  if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as Record<string, unknown>)['type'] === 'entity.parse.failed'
  ) {
    res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' },
    });
    return;
  }

  // Prisma unique constraint violation — P2002
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const fields = (err.meta?.target as string[] | undefined) ?? [];
    const field = fields[0] ?? 'field';
    const code = field === 'phone_number' ? 'PHONE_ALREADY_IN_USE'
      : field === 'email'        ? 'EMAIL_ALREADY_IN_USE'
      : 'UNIQUE_CONSTRAINT_VIOLATION';
    res.status(409).json({
      error: { code, message: `This ${field.replace('_', ' ')} is already in use` },
    });
    return;
  }

  // Unexpected errors — do not leak internals
  const requestId = _req.headers['x-request-id'] ?? _req.headers['x-correlation-id'];
  console.error('[errorHandler] Unhandled error', { requestId, err });
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  });
};
