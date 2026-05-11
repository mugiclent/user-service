/**
 * Tests for src/api/bank.controller.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockSoftDelete = vi.fn();

vi.mock('../../src/services/bank.service.js', () => ({
  BankService: {
    list: mockList,
    create: mockCreate,
    update: mockUpdate,
    softDelete: mockSoftDelete,
  },
}));

const { BankController } = await import('../../src/api/bank.controller.js');

const makeReq = (overrides: { params?: Record<string, string>; body?: object } = {}): Request => ({
  user: { id: 'admin-1', rules: [] },
  params: overrides.params ?? {},
  body: overrides.body ?? {},
} as unknown as Request);

const makeRes = (): Response => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn(),
  end: vi.fn(),
} as unknown as Response);

const fakeBank = { id: 'bank-1', name: 'Equity Bank', is_active: true, created_at: new Date(), updated_at: new Date() };

beforeEach(() => vi.clearAllMocks());

describe('BankController.list', () => {
  it('returns 200 with bank list', async () => {
    mockList.mockResolvedValue({ data: [fakeBank] });
    const res = makeRes();
    await BankController.list(makeReq(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: [fakeBank] });
  });

  it('calls next(err) on service error', async () => {
    mockList.mockRejectedValue(new Error('db error'));
    const next = vi.fn() as NextFunction;
    await BankController.list(makeReq(), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe('BankController.create', () => {
  it('returns 201 with created bank', async () => {
    mockCreate.mockResolvedValue(fakeBank);
    const res = makeRes();
    await BankController.create(makeReq({ body: { name: 'Equity Bank' } }), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(fakeBank);
  });

  it('calls next(err) on service error', async () => {
    mockCreate.mockRejectedValue(new Error('conflict'));
    const next = vi.fn() as NextFunction;
    await BankController.create(makeReq({ body: { name: 'X' } }), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe('BankController.update', () => {
  it('returns 200 with updated bank', async () => {
    mockUpdate.mockResolvedValue({ ...fakeBank, name: 'BK' });
    const res = makeRes();
    await BankController.update(makeReq({ params: { id: 'bank-1' }, body: { name: 'BK' } }), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ...fakeBank, name: 'BK' });
  });

  it('calls next(err) on service error', async () => {
    mockUpdate.mockRejectedValue(new Error('not found'));
    const next = vi.fn() as NextFunction;
    await BankController.update(makeReq({ params: { id: 'bank-1' } }), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe('BankController.softDelete', () => {
  it('returns 204', async () => {
    mockSoftDelete.mockResolvedValue(undefined);
    const res = makeRes();
    await BankController.softDelete(makeReq({ params: { id: 'bank-1' } }), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('calls next(err) on service error', async () => {
    mockSoftDelete.mockRejectedValue(new Error('not found'));
    const next = vi.fn() as NextFunction;
    await BankController.softDelete(makeReq({ params: { id: 'bank-1' } }), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
