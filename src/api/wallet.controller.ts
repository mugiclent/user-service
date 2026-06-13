import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedUser } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { WalletService } from '../services/wallet.service.js';
import { getRedisClient } from '../loaders/redis.js';
import { topupStatusKey } from '../utils/topup-status.js';

const SSE_TIMEOUT_MS = 3 * 60 * 1000;

export const WalletController = {
  async getWallet(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await WalletService.getWallet(user.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async initiateTopup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await WalletService.initiateTopup(user.id, req.body as {
        amount: number;
        phone?: string;
        payment_method: 'mtn' | 'airtel';
      });
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const q = req.query as { page?: string; limit?: string; type?: string };
      const result = await WalletService.getTransactions(user.id, {
        page: q.page ? parseInt(q.page, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
        type: q.type,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getUserTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params['id']!;
      const q = req.query as { page?: string; limit?: string; type?: string };
      const result = await WalletService.getTransactions(userId, {
        page: q.page ? parseInt(q.page, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
        type: q.type,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async streamTopup(req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = req.user as AuthenticatedUser;
    const topupId = req.params['id']!;

    try {
      const isOwner = await WalletService.verifyTopupOwner(topupId, user.id);
      if (!isOwner) return next(new AppError('NOT_FOUND', 404));
    } catch (err) {
      return next(err);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(`event: pending\ndata: ${JSON.stringify({ status: 'pending' })}\n\n`);

    const sub = getRedisClient().duplicate();
    let done = false;
    let cleanedUp = false;
    let timeoutHandle: ReturnType<typeof setTimeout>;

    const send = (event: string, data: object): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const cleanup = async (): Promise<void> => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeoutHandle);
      await sub.unsubscribe().catch(() => {});
      await sub.quit().catch(() => {});
    };

    // Emit a terminal outcome at most once (guards against replay + live both firing).
    // The bridge already shaped the payload to the SSE contract, incl. its `status`,
    // which we use as the event name (confirmed | failed).
    const finish = async (payload: { status?: string; [k: string]: unknown }): Promise<void> => {
      if (done) return;
      done = true;
      send(payload.status ?? 'failed', payload);
      res.end();
      await cleanup();
    };

    timeoutHandle = setTimeout(() => {
      void finish({ status: 'timeout', message: 'Payment timed out. Please try again.' });
    }, SSE_TIMEOUT_MS);

    sub.on('message', (_channel: string, message: string) => {
      try {
        void finish(JSON.parse(message) as Record<string, unknown>);
      } catch {
        void finish({ status: 'failed', message: 'Payment was not completed. Please try again.' });
      }
    });

    sub.on('error', (err: Error) => {
      console.error('[wallet-stream] Redis subscriber error', err);
      void finish({ status: 'failed', message: 'Payment was not completed. Please try again.' });
    });

    req.on('close', () => { void cleanup(); });

    // Subscribe BEFORE reading the persisted status so we can't miss an outcome that
    // lands in the gap. If the top-up already resolved (client connected late or
    // reconnected), replay it immediately instead of waiting for the timeout.
    await sub.subscribe(`topup:${topupId}`);
    const persisted = await getRedisClient().get(topupStatusKey(topupId));
    if (persisted) {
      try { await finish(JSON.parse(persisted) as Record<string, unknown>); } catch { /* ignore malformed */ }
    }
  },
};
