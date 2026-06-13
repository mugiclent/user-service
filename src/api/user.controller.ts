import type { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service.js';
import { MediaService } from '../services/media.service.js';
import type { AuthenticatedUser } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { consumeSudoToken } from '../middleware/consumeSudoToken.js';
import { getRedisClient } from '../loaders/redis.js';
import type { SudoAction } from '../utils/sudoToken.js';
import { sendRefreshResponse } from '../utils/sendAuthResponse.js';
import type { ClientType } from '../services/token.service.js';

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
      const body = req.body as {
        first_name?: string;
        last_name?: string;
        phone_number?: string;
        email?: string;
        avatar_path?: string | null;
        notif_channel?: string[];
        locale?: string;
        two_factor_enabled?: boolean;
        password?: string;
      };

      if (body.password !== undefined) {
        await consumeSudoToken(
          req.headers['x-sudo-token'] as string | undefined,
          user.id,
          'change_password',
          getRedisClient(),
        );
        const clientType: ClientType = req.headers['x-client-type'] === 'mobile' ? 'mobile' : 'web';
        const tokens = await UserService.changePassword(user.id, body.password, {
          user_agent: req.headers['user-agent'],
          ip_address: req.ip,
          clientType,
          reqLocale: user.locale,
        });
        // Stay logged in on THIS device with a brand-new session: web gets fresh
        // cookies (204), mobile gets the new tokens in the body (200).
        sendRefreshResponse(req, res, tokens);
        return;
      }

      const result = await UserService.updateMe(user, body);
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
      const { password, action } = req.body as { password: string; action: string };
      const result = await UserService.validatePassword(user.id, password, action as SudoAction);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async deleteSelf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      await consumeSudoToken(
        req.headers['x-sudo-token'] as string | undefined,
        user.id,
        'delete_account',
        getRedisClient(),
      );
      await UserService.deleteSelf(user.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      // Validated + coerced by listUsersQuerySchema (validateQuery middleware).
      const query = req.query as unknown as {
        page?: number;
        limit?: number;
        status?: string;
        user_type?: string;
        org_id?: string;
        role?: string[];
        q?: string;
      };
      const result = await UserService.listUsers(user, {
        page: query.page,
        limit: query.limit,
        status: query.status,
        user_type: query.user_type,
        org_id: query.org_id,
        role: query.role,
        q: query.q,
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
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async assignRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const { role_slugs } = req.body as { role_slugs: string[] };
      const result = await UserService.assignRoles(user, req.params['id']!, role_slugs);
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
        role_slugs: string[];
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
        q: req.query['q'] as string | undefined,
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
        role_slugs?: string[];
        locale?: string;
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getInvitationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await UserService.getInvitationById(user, req.params['id']!);
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

  async setInvitationGrants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await UserService.setInvitationGrants(
        user,
        req.params['id']!,
        (req.body as { patterns: string[] }).patterns,
      );
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

  async addUserGrants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await UserService.addUserGrants(
        user,
        req.params['id']!,
        (req.body as { patterns: string[] }).patterns,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async removeUserGrant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      await UserService.removeUserGrant(user, req.params['id']!, req.params['grantId']!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /users/me/devices
   * List FCM-registered devices for the authenticated user.
   */
  async listMyDevices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      const result = await UserService.listMyDevices(user.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
};
