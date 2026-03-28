/**
 * Tests for src/utils/AppError.ts
 */
import { describe, it, expect } from 'vitest';
import { AppError } from '../../src/utils/AppError.js';

describe('AppError', () => {
  it('sets code, status, and message', () => {
    const e = new AppError('NOT_FOUND', 404);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.status).toBe(404);
    expect(e.message).toBe('NOT_FOUND');
  });

  it('is an instance of Error', () => {
    expect(new AppError('E', 400)).toBeInstanceOf(Error);
  });

  it('has name AppError', () => {
    expect(new AppError('E', 400).name).toBe('AppError');
  });

  it('stores optional details', () => {
    const details = [{ message: 'bad field' }];
    const e = new AppError('VALIDATION_ERROR', 422, details);
    expect(e.details).toBe(details);
  });

  it('details is undefined when not provided', () => {
    expect(new AppError('E', 400).details).toBeUndefined();
  });

  it('instanceof AppError works after throw/catch (prototype chain)', () => {
    try {
      throw new AppError('TEST', 500);
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});
