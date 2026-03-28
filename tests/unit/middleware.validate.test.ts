/**
 * Tests for src/middleware/validate.ts
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { validate } from '../../src/middleware/validate.js';
import { AppError } from '../../src/utils/AppError.js';

const schema = Joi.object({ name: Joi.string().required(), age: Joi.number().optional() });
const res = {} as Response;

describe('validate', () => {
  it('calls next() and sets req.body to validated value on valid input', () => {
    const req = { body: { name: 'Alice', age: 30 } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    validate(schema)(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ name: 'Alice', age: 30 });
  });

  it('calls next(AppError 422) on invalid input', () => {
    const req = { body: {} } as unknown as Request;
    const next = vi.fn() as NextFunction;
    validate(schema)(req, res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('includes Joi details in the error', () => {
    const req = { body: {} } as unknown as Request;
    const next = vi.fn() as NextFunction;
    validate(schema)(req, res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as AppError;
    expect(Array.isArray(err.details)).toBe(true);
  });

  it('reports all validation errors (abortEarly: false)', () => {
    const multi = Joi.object({ a: Joi.string().required(), b: Joi.number().required() });
    const req = { body: {} } as unknown as Request;
    const next = vi.fn() as NextFunction;
    validate(multi)(req, res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as AppError;
    expect((err.details as unknown[]).length).toBeGreaterThan(1);
  });
});
