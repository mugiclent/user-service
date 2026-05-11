import type { Request, Response, NextFunction } from 'express';
import { BankService } from '../services/bank.service.js';

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
      const result = await BankService.create(req.body as { name: string });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await BankService.update(req.params['id']!, req.body as { name?: string; is_active?: boolean });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await BankService.softDelete(req.params['id']!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
};
