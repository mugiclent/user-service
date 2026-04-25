import type { Request, Response, NextFunction } from 'express';
import { OrgService } from '../services/org.service.js';
import { MediaService } from '../services/media.service.js';
import type { AuthenticatedUser } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

export const OrgController = {
  async createOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await OrgService.createOrg(user, req.body as {
        name: string;
        org_type: string;
        contact_first_name: string;
        contact_last_name: string;
        contact_email: string;
        contact_phone: string;
        address?: string;
        tin: string;
        license_number?: string;
        parent_org_id?: string;
        story?: string;
        status?: string;
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async listOrgs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const query = req.query as {
        page?: string;
        limit?: string;
        status?: string;
        org_type?: string;
        q?: string;
      };
      const result = await OrgService.listOrgs(user, {
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        status: query.status,
        org_type: query.org_type,
        q: query.q,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getMyOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await OrgService.getMyOrg(user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getOrgById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await OrgService.getOrgById(user, req.params['id']!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await OrgService.updateOrg(user, req.params['id']!, req.body as {
        name?: string;
        contact_email?: string;
        contact_phone?: string;
        address?: string;
        logo_path?: string;
        story?: string | null;
        status?: string;
        rejection_reason?: string;
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getLogoPresignedUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['id'] ?? (req.user as AuthenticatedUser).org_id;
      if (!orgId) return next(new AppError('NO_ORG', 400));
      const contentType = req.query['content_type'] as string | undefined;
      if (!contentType) return next(new AppError('MISSING_CONTENT_TYPE', 400));
      const result = await MediaService.generateOrgLogoPresignedUrl(orgId, contentType);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async cooperativeApprove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await OrgService.cooperativeApprove(user, req.params['id']!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async cooperativeReject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const { reason } = req.body as { reason?: string };
      await OrgService.cooperativeReject(user, req.params['id']!, reason);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
};
