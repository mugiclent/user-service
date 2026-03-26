import type { Request, Response, NextFunction } from 'express';
import { OrgService } from '../services/org.service.js';
import type { UserWithRoles } from '../models/index.js';

export const OrgController = {
  async createOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const result = await OrgService.createOrg(user, req.body as {
        name: string;
        org_type: string;
        contact_email: string;
        contact_phone: string;
        address?: string;
        tin?: string;
        license_number?: string;
        parent_org_id?: string;
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async listOrgs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const query = req.query as {
        page?: string;
        limit?: string;
        status?: string;
        org_type?: string;
      };
      const result = await OrgService.listOrgs(user, {
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        status: query.status,
        org_type: query.org_type,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getMyOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const result = await OrgService.getMyOrg(user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getOrgById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const result = await OrgService.getOrgById(user, req.params['id']!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const result = await OrgService.updateOrg(user, req.params['id']!, req.body as {
        name?: string;
        contact_email?: string;
        contact_phone?: string;
        address?: string;
        logo_url?: string;
        status?: string;
        rejection_reason?: string;
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async approveChildOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const result = await OrgService.approveChildOrg(user, req.params['id']!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
};
