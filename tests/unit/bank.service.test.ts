/**
 * Tests for src/services/bank.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBankFindMany = vi.fn();
const mockBankFindUnique = vi.fn();
const mockBankCreate = vi.fn();
const mockBankUpdate = vi.fn();

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    bank: {
      findMany: mockBankFindMany,
      findUnique: mockBankFindUnique,
      create: mockBankCreate,
      update: mockBankUpdate,
    },
  },
}));

const { BankService } = await import('../../src/services/bank.service.js');

const fakeBank = {
  id: 'bank-1',
  name: 'Equity Bank',
  is_active: true,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

beforeEach(() => vi.clearAllMocks());

describe('BankService.list', () => {
  it('returns all banks ordered by name', async () => {
    mockBankFindMany.mockResolvedValue([fakeBank]);
    const result = await BankService.list();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'bank-1', name: 'Equity Bank', is_active: true });
    expect(mockBankFindMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });
});

describe('BankService.create', () => {
  it('creates a bank and returns it', async () => {
    mockBankFindUnique.mockResolvedValue(null);
    mockBankCreate.mockResolvedValue(fakeBank);

    const result = await BankService.create({ name: 'Equity Bank' });
    expect(result).toMatchObject({ id: 'bank-1', name: 'Equity Bank' });
    expect(mockBankCreate).toHaveBeenCalledWith({ data: { name: 'Equity Bank' } });
  });

  it('throws BANK_ALREADY_EXISTS when name is taken', async () => {
    mockBankFindUnique.mockResolvedValue(fakeBank);
    await expect(BankService.create({ name: 'Equity Bank' })).rejects.toMatchObject({ code: 'BANK_ALREADY_EXISTS', status: 409 });
  });
});

describe('BankService.update', () => {
  it('updates a bank', async () => {
    mockBankFindUnique.mockResolvedValueOnce(fakeBank).mockResolvedValueOnce(null);
    mockBankUpdate.mockResolvedValue({ ...fakeBank, name: 'Bank of Kigali' });

    const result = await BankService.update('bank-1', { name: 'Bank of Kigali' });
    expect(result.name).toBe('Bank of Kigali');
  });

  it('throws BANK_NOT_FOUND when bank does not exist', async () => {
    mockBankFindUnique.mockResolvedValue(null);
    await expect(BankService.update('no-such', { name: 'X' })).rejects.toMatchObject({ code: 'BANK_NOT_FOUND', status: 404 });
  });

  it('throws BANK_ALREADY_EXISTS when new name conflicts with another bank', async () => {
    mockBankFindUnique
      .mockResolvedValueOnce(fakeBank)
      .mockResolvedValueOnce({ ...fakeBank, id: 'bank-2', name: 'Bank of Kigali' });
    await expect(BankService.update('bank-1', { name: 'Bank of Kigali' })).rejects.toMatchObject({ code: 'BANK_ALREADY_EXISTS', status: 409 });
  });

  it('deactivates a bank via is_active=false', async () => {
    mockBankFindUnique.mockResolvedValue(fakeBank);
    mockBankUpdate.mockResolvedValue({ ...fakeBank, is_active: false });

    const result = await BankService.update('bank-1', { is_active: false });
    expect(result.is_active).toBe(false);
  });
});

describe('BankService.softDelete', () => {
  it('sets is_active=false', async () => {
    mockBankFindUnique.mockResolvedValue(fakeBank);
    mockBankUpdate.mockResolvedValue({ ...fakeBank, is_active: false });

    await BankService.softDelete('bank-1');
    expect(mockBankUpdate).toHaveBeenCalledWith({ where: { id: 'bank-1' }, data: { is_active: false } });
  });

  it('throws BANK_NOT_FOUND when bank does not exist', async () => {
    mockBankFindUnique.mockResolvedValue(null);
    await expect(BankService.softDelete('no-such')).rejects.toMatchObject({ code: 'BANK_NOT_FOUND', status: 404 });
  });
});
