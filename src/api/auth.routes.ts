import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { loginRateLimiter, resetRateLimiter } from '../middleware/rateLimiter.js';
import {
  loginSchema,
  registerSchema,
  verifyPhoneSchema,
  verify2faSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../middleware/schemas/auth.schema.js';

const router = Router();

// POST /api/v1/auth/login
router.post('/login', loginRateLimiter, validate(loginSchema), AuthController.login);

// POST /api/v1/auth/register
router.post('/register', validate(registerSchema), AuthController.register);

// POST /api/v1/auth/verify-phone
router.post('/verify-phone', validate(verifyPhoneSchema), AuthController.verifyPhone);

// POST /api/v1/auth/verify-2fa  — step 2 when two_factor_enabled = true
router.post('/verify-2fa', validate(verify2faSchema), AuthController.verify2fa);

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', resetRateLimiter, validate(forgotPasswordSchema), AuthController.forgotPassword);

// POST /api/v1/auth/reset-password
router.post('/reset-password', validate(resetPasswordSchema), AuthController.resetPassword);

// POST /api/v1/auth/refresh  (no authenticate — token IS the credential)
router.post('/refresh', AuthController.refresh);

// POST /api/v1/auth/logout  (no authenticate — mobile sends refresh token; web reads cookie)
router.post('/logout', AuthController.logout);

// POST /api/v1/auth/logout-all  (requires valid access token)
router.post('/logout-all', authenticate, AuthController.logoutAll);

export default router;
