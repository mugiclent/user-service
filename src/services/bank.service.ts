import { prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

type BankRow = { id: string; name: string; is_active: boolean; created_at: Date; updated_at: Date };

const serialize = (b: BankRow) => ({
  id: b.id,
  name: b.name,
  is_active: b.is_active,
  created_at: b.created_at,
  updated_at: b.updated_at,
});

export const BankService = {
  async list(): Promise<{ data: ReturnType<typeof serialize>[] }> {
    const banks = await prisma.bank.findMany({ orderBy: { name: 'asc' } });
    return { data: banks.map(serialize) };
  },

  async create(data: { name: string }): Promise<ReturnType<typeof serialize>> {
    const existing = await prisma.bank.findUnique({ where: { name: data.name } });
    if (existing) throw new AppError('BANK_ALREADY_EXISTS', 409);

    const bank = await prisma.bank.create({ data: { name: data.name } });
    return serialize(bank);
  },

  async update(id: string, data: { name?: string; is_active?: boolean }): Promise<ReturnType<typeof serialize>> {
    const bank = await prisma.bank.findUnique({ where: { id } });
    if (!bank) throw new AppError('BANK_NOT_FOUND', 404);

    if (data.name && data.name !== bank.name) {
      const conflict = await prisma.bank.findUnique({ where: { name: data.name } });
      if (conflict) throw new AppError('BANK_ALREADY_EXISTS', 409);
    }

    const updated = await prisma.bank.update({ where: { id }, data });
    return serialize(updated);
  },

  async softDelete(id: string): Promise<void> {
    const bank = await prisma.bank.findUnique({ where: { id } });
    if (!bank) throw new AppError('BANK_NOT_FOUND', 404);
    await prisma.bank.update({ where: { id }, data: { is_active: false } });
  },
};
