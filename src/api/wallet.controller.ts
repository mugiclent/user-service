import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedUser } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { WalletService } from '../services/wallet.service.js';
import { getRedisClient } from '../loaders/redis.js';

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
        phone_number?: string;
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
      const q = req.query as { page?: string; limit?: string };
      const result = await WalletService.getTransactions(user.id, {
        page: q.page ? parseInt(q.page, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getUserTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params['id']!;
      const q = req.query as { page?: string; limit?: string };
      const result = await WalletService.getTransactions(userId, {
        page: q.page ? parseInt(q.page, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
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

    res.write(`event: pending\ndata: ${JSON.stringify({ status: 'pending', topup_id: topupId })}\n\n`);

    const sub = getRedisClient().duplicate();
    let done = false;
    let timeoutHandle: ReturnType<typeof setTimeout>;

    const send = (event: string, data: object): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const cleanup = async (): Promise<void> => {
      if (done) return;
      done = true;
      clearTimeout(timeoutHandle);
      await sub.unsubscribe().catch(() => {});
      await sub.quit().catch(() => {});
    };

    timeoutHandle = setTimeout(async () => {
      send('timeout', { message: 'Payment confirmation timed out' });
      res.end();
      await cleanup();
    }, SSE_TIMEOUT_MS);

    sub.on('message', async (_channel: string, message: string) => {
      try {
        const payload = JSON.parse(message) as { type: string; [key: string]: unknown };
        const eventName = payload.type === 'topup.payment.confirmed' ? 'completed' : 'failed';
        send(eventName, payload);
      } catch {
        send('failed', { message: 'Malformed payment event' });
      }
      res.end();
      await cleanup();
    });

    sub.on('error', async (err: Error) => {
      console.error('[wallet-stream] Redis subscriber error', err);
      send('failed', { message: 'Stream error' });
      res.end();
      await cleanup();
    });

    req.on('close', async () => {
      await cleanup();
    });

    await sub.subscribe(`topup:${topupId}`);
  },
};
