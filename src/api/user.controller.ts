import type { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service.js';
import { TokenService } from '../services/token.service.js';
import { MediaService } from '../services/media.service.js';
import { sendAuthResponse } from '../utils/sendAuthResponse.js';
import { serializeUserForAuth } from '../models/serializers.js';
import type { AuthenticatedUser } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

export const UserController = {
  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await UserService.getMe(user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await UserService.updateMe(user, req.body as {
        first_name?: string;
        last_name?: string;
        email?: string;
        avatar_path?: string | null;
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getAvatarPresignedUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const contentType = req.query['content_type'] as string | undefined;
      if (!contentType) {
        return next(new AppError('MISSING_CONTENT_TYPE', 400));
      }
      const result = await MediaService.generateUserAvatarPresignedUrl(user.id, contentType);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async validatePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      await UserService.validatePassword(user.id, (req.body as { password: string }).password);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async toggle2fa(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await UserService.toggle2fa(user.id, (req.body as { enabled: boolean }).enabled);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
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
      const user = req.user as AuthenticatedUser;
      const result = await UserService.getUserById(user, req.params['id']!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
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
      const user = req.user as AuthenticatedUser;
      await UserService.deleteUser(user, req.params['id']!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async inviteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
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
