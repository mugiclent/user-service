/**
 * Tests for src/services/bank.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedUser } from '../../src/models/index.js';

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

// ── ability mock — controls whether the caller is platform or org scope ────────

const mockGetScopeFor = vi.fn().mockReturnValue('platform');
const mockBuildAbility = vi.fn().mockReturnValue({});

vi.mock('../../src/utils/ability.js', () => ({
  buildAbilityFromRules: (...args: unknown[]) => mockBuildAbility(...args),
  getScopeFor: (...args: unknown[]) => mockGetScopeFor(...args),
}));

const { BankService } = await import('../../src/services/bank.service.js');

const platformUser = {
  id: 'admin-1',
  rules: [],
} as unknown as AuthenticatedUser;

const orgUser = {
  id: 'org-user-1',
  rules: [],
} as unknown as AuthenticatedUser;

const fakeBank = {
  id: 'bank-1',
  name: 'Equity Bank',
  is_active: true,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetScopeFor.mockReturnValue('platform');
});

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

    const result = await BankService.create(platformUser, { name: 'Equity Bank' });
    expect(result).toMatchObject({ id: 'bank-1', name: 'Equity Bank' });
    expect(mockBankCreate).toHaveBeenCalledWith({ data: { name: 'Equity Bank' } });
  });

  it('throws FORBIDDEN when caller is not platform scope', async () => {
    mockGetScopeFor.mockReturnValue('org');
    await expect(BankService.create(orgUser, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('throws BANK_ALREADY_EXISTS when name is taken', async () => {
    mockBankFindUnique.mockResolvedValue(fakeBank);
    await expect(BankService.create(platformUser, { name: 'Equity Bank' })).rejects.toMatchObject({ code: 'BANK_ALREADY_EXISTS', status: 409 });
  });
});

describe('BankService.update', () => {
  it('updates a bank', async () => {
    mockBankFindUnique.mockResolvedValueOnce(fakeBank).mockResolvedValueOnce(null);
    mockBankUpdate.mockResolvedValue({ ...fakeBank, name: 'Bank of Kigali' });

    const result = await BankService.update(platformUser, 'bank-1', { name: 'Bank of Kigali' });
    expect(result.name).toBe('Bank of Kigali');
  });

  it('throws FORBIDDEN when caller is not platform scope', async () => {
    mockGetScopeFor.mockReturnValue('org');
    await expect(BankService.update(orgUser, 'bank-1', { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('throws BANK_NOT_FOUND when bank does not exist', async () => {
    mockBankFindUnique.mockResolvedValue(null);
    await expect(BankService.update(platformUser, 'no-such', { name: 'X' })).rejects.toMatchObject({ code: 'BANK_NOT_FOUND', status: 404 });
  });

  it('throws BANK_ALREADY_EXISTS when new name conflicts with another bank', async () => {
    mockBankFindUnique
      .mockResolvedValueOnce(fakeBank)
      .mockResolvedValueOnce({ ...fakeBank, id: 'bank-2', name: 'Bank of Kigali' });
    await expect(BankService.update(platformUser, 'bank-1', { name: 'Bank of Kigali' })).rejects.toMatchObject({ code: 'BANK_ALREADY_EXISTS', status: 409 });
  });

  it('deactivates a bank via is_active=false', async () => {
    mockBankFindUnique.mockResolvedValue(fakeBank);
    mockBankUpdate.mockResolvedValue({ ...fakeBank, is_active: false });

    const result = await BankService.update(platformUser, 'bank-1', { is_active: false });
    expect(result.is_active).toBe(false);
  });
});

describe('BankService.softDelete', () => {
  it('sets is_active=false', async () => {
    mockBankFindUnique.mockResolvedValue(fakeBank);
    mockBankUpdate.mockResolvedValue({ ...fakeBank, is_active: false });

    await BankService.softDelete(platformUser, 'bank-1');
    expect(mockBankUpdate).toHaveBeenCalledWith({ where: { id: 'bank-1' }, data: { is_active: false } });
  });

  it('throws FORBIDDEN when caller is not platform scope', async () => {
    mockGetScopeFor.mockReturnValue('org');
    await expect(BankService.softDelete(orgUser, 'bank-1')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('throws BANK_NOT_FOUND when bank does not exist', async () => {
    mockBankFindUnique.mockResolvedValue(null);
    await expect(BankService.softDelete(platformUser, 'no-such')).rejects.toMatchObject({ code: 'BANK_NOT_FOUND', status: 404 });
  });
});
