import { prisma } from '../models/index.js';

const RETRY_DELAY_MS = 3_000;
const HEALTH_CACHE_TTL_MS = 5_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const initPrisma = async (): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$connect();
      console.warn('[prisma] Connected to database');
      return;
    } catch {
      console.warn(`[prisma] Database not ready (attempt ${attempt}) — retrying in ${RETRY_DELAY_MS / 1000}s`);
      await sleep(RETRY_DELAY_MS);
    }
  }
};

// Cached so rapid health polls (e.g. Docker every 30s) don't hammer the DB.
let dbHealthCache: { ok: boolean; error?: string; ts: number } | null = null;

export async function checkDbHealth(): Promise<{ ok: boolean; error?: string }> {
  const now = Date.now();
  if (dbHealthCache && now - dbHealthCache.ts < HEALTH_CACHE_TTL_MS) {
    const { ok, error } = dbHealthCache;
    return { ok, error };
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbHealthCache = { ok: true, ts: now };
    return { ok: true };
  } catch (err) {
    const error = (err as Error).message;
    dbHealthCache = { ok: false, error, ts: now };
    return { ok: false, error };
  }
}
