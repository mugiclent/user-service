import type { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service.js';
import { TokenService } from '../services/token.service.js';
import { sendAuthResponse } from '../utils/sendAuthResponse.js';
import { serializeUserForAuth } from '../models/serializers.js';
import type { UserWithRoles } from '../models/index.js';

export const UserController = {
  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const result = await UserService.getMe(user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const result = await UserService.updateMe(user.id, req.body as {
        first_name?: string;
        last_name?: string;
        email?: string;
        avatar_url?: string;
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const query = req.query as {
        page?: string;
        limit?: string;
        status?: string;
        user_type?: string;
        org_id?: string;
      };
      const result = await UserService.listUsers(user, {
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        status: query.status,
        user_type: query.user_type,
        org_id: query.org_id,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const result = await UserService.getUserById(user, req.params['id']!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const result = await UserService.updateUser(user, req.params['id']!, req.body as {
        first_name?: string;
        last_name?: string;
        status?: string;
        org_id?: string;
        role_slugs?: string[];
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      await UserService.deleteUser(user, req.params['id']!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async inviteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as UserWithRoles;
      const result = await UserService.inviteUser(user, req.body as {
        email?: string;
        phone_number?: string;
        first_name: string;
        last_name: string;
        role_slug: string;
        org_id?: string;
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async acceptInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password, device_name } = req.body as {
        token: string;
        password: string;
        device_name?: string;
      };
      const { user } = await UserService.acceptInvite(token, password);
      const tokens = await TokenService.issueTokenPair(user, device_name);
      sendAuthResponse(req, res, { user: serializeUserForAuth(user), tokens });
    } catch (err) {
      next(err);
    }
  },
};
