import { prisma } from '../models/index.js';

export const initPrisma = async (): Promise<void> => {
  await prisma.$connect();
};
