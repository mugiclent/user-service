import type { Request, Response, NextFunction } from 'express';
import { RoleService } from '../services/role.service.js';
import type { AuthenticatedUser } from '../models/index.js';

export const RoleController = {
  async listRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await RoleService.listRoles(user, {
        org_id: req.query['org_id'] as string | undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async createRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await RoleService.createRole(user, req.body as {
        name: string;
        slug?: string;
        org_id?: string;
        patterns: string[];
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getRoleById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await RoleService.getRoleById(user, req.params['id']!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await RoleService.updateRole(user, req.params['id']!, req.body as { name: string });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async deleteRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      await RoleService.deleteRole(user, req.params['id']!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async addGrant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await RoleService.addGrant(user, req.params['id']!, (req.body as { pattern: string }).pattern);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async removeGrant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      await RoleService.removeGrant(user, req.params['id']!, req.params['grantId']!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
};
