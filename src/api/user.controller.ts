import type { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service.js';
import { MediaService } from '../services/media.service.js';
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
        phone_number?: string;
        email?: string;
        avatar_path?: string | null;
        notif_channel?: string[];
        locale?: string;
        two_factor_enabled?: boolean;
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
        locale?: string;
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async acceptInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password } = req.body as { token: string; password: string };
      const result = await UserService.acceptInvite(token, password);
      res.status(200).json({
        message: 'Account created. Please verify your account to log in.',
        user_id: result.user_id,
        channels: result.channels,
      });
    } catch (err) {
      next(err);
    }
  },

  async requestLoginChannelChange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const { channel, identifier } = req.body as { channel: 'phone' | 'email'; identifier?: string };
      const result = await UserService.requestLoginChannelChange(user.id, channel, identifier);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async confirmLoginChannelChange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const { channel, otp } = req.body as { channel: 'phone' | 'email'; otp: string };
      const result = await UserService.confirmLoginChannelChange(user.id, channel, otp);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async listInvitations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await UserService.listInvitations(user, {
        page: req.query['page'] ? Number(req.query['page']) : undefined,
        limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
        org_id: req.query['org_id'] as string | undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await UserService.updateInvitation(user, req.params['id']!, req.body as {
        first_name?: string;
        last_name?: string;
        email?: string;
        phone_number?: string;
        role_slug?: string;
        locale?: string;
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async resendInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await UserService.resendInvitation(user, req.params['id']!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async deleteInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      await UserService.deleteInvitation(user, req.params['id']!);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
