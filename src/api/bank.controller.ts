import type { Request, Response, NextFunction } from 'express';
import { BankService } from '../services/bank.service.js';
import type { AuthenticatedUser } from '../models/index.js';

export const BankController = {
  async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await BankService.list();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await BankService.create(user, req.body as { name: string });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await BankService.update(user, req.params['id']!, req.body as { name?: string; is_active?: boolean });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      await BankService.softDelete(user, req.params['id']!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
};
