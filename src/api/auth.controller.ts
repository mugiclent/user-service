import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { serializeUserForAuth } from '../models/serializers.js';
import { sendAuthResponse, sendRefreshResponse, clearAuthCookies } from '../utils/sendAuthResponse.js';
import type { AuthenticatedUser } from '../models/index.js';

export const AuthController = {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { identifier, password, device_name } = req.body as {
        identifier: string;
        password: string;
        device_name?: string;
      };
      const result = await AuthService.login(identifier, password, device_name, req.ip);

      if (result.requires_2fa) {
        // Step 1 of 2FA: OTP sent, token issuance deferred
        res.status(202).json({
          requires_2fa: true,
          user_id: result.user_id,
          expires_in: result.expires_in,
        });
        return;
      }

      sendAuthResponse(req, res, { user: serializeUserForAuth(result.user), tokens: result.tokens });
    } catch (err) {
      next(err);
    }
  },

  async verify2fa(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user_id, otp, device_name } = req.body as {
        user_id: string;
        otp: string;
        device_name?: string;
      };
      const { user, tokens } = await AuthService.verify2fa(user_id, otp, device_name, req.ip);
      sendAuthResponse(req, res, { user: serializeUserForAuth(user), tokens });
    } catch (err) {
      next(err);
    }
  },

  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.register(req.body as {
        first_name: string;
        last_name: string;
        phone_number: string;
        password: string;
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async verifyPhone(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user_id, otp, device_name } = req.body as {
        user_id: string;
        otp: string;
        device_name?: string;
      };
      const { user, tokens } = await AuthService.verifyPhone(user_id, otp, device_name);
      sendAuthResponse(req, res, { user: serializeUserForAuth(user), tokens });
    } catch (err) {
      next(err);
    }
  },

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await AuthService.forgotPassword((req.body as { identifier: string }).identifier);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, new_password } = req.body as { token: string; new_password: string };
      await AuthService.resetPassword(token, new_password);
      clearAuthCookies(res);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const isMobile = req.headers['x-client-type'] === 'mobile';
      let rawToken: string | undefined;

      if (isMobile) {
        const auth = req.headers.authorization;
        rawToken = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
      } else {
        rawToken = req.cookies?.refresh_token as string | undefined;
      }

      if (!rawToken) {
        res.status(401).json({ error: { code: 'MISSING_REFRESH_TOKEN' } });
        return;
      }

      const { tokens } = await AuthService.refresh(rawToken);
      sendRefreshResponse(req, res, tokens);
    } catch (err) {
      next(err);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const isMobile = req.headers['x-client-type'] === 'mobile';
      let rawToken: string | undefined;

      if (isMobile) {
        const auth = req.headers.authorization;
        rawToken = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
      } else {
        rawToken = req.cookies?.refresh_token as string | undefined;
      }

      if (rawToken) await AuthService.logout(rawToken);
      clearAuthCookies(res);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async logoutAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as AuthenticatedUser;
      await AuthService.logoutAll(user.id);
      clearAuthCookies(res);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
};
