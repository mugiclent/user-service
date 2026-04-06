import type { Request, Response, NextFunction } from 'express';
import { PermissionService } from '../services/permission.service.js';

export const PermissionController = {
  async listPermissions(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await PermissionService.listPermissions();
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
};
