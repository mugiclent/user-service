// Route declarations — excluded from unit test coverage (see vitest.config.ts)
import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { loginRateLimiter, resetRateLimiter, resendOtpRateLimiter } from '../middleware/rateLimiter.js';
import {
  loginSchema,
  registerSchema,
  verifyPhoneSchema,
  verifyEmailSchema,
  verifyLoginSchema,
  verify2faSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  registerDeviceSchema,
  resendOtpSchema,
} from '../middleware/schemas/auth.schema.js';

const router = Router();

// POST /api/v1/auth/login
router.post('/login', loginRateLimiter, validate(loginSchema), AuthController.login);

// POST /api/v1/auth/register
router.post('/register', validate(registerSchema), AuthController.register);

// POST /api/v1/auth/verify-phone  — standalone (no tokens; user directed to log in)
router.post('/verify-phone', validate(verifyPhoneSchema), AuthController.verifyPhone);

// POST /api/v1/auth/verify-email  — standalone (no tokens; user directed to log in)
router.post('/verify-email', validate(verifyEmailSchema), AuthController.verifyEmail);

// POST /api/v1/auth/verify-login  — OTP verification during login flow (issues tokens)
router.post('/verify-login', validate(verifyLoginSchema), AuthController.verifyLogin);

// POST /api/v1/auth/verify-2fa  — step 2 when two_factor_enabled = true
router.post('/verify-2fa', validate(verify2faSchema), AuthController.verify2fa);

// GET /api/v1/auth/invite/validate  — validate invite token before showing set-password form
router.get('/invite/validate', AuthController.validateInviteToken);

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

// POST /api/v1/auth/resend-otp  (resend phone verification OTP to a pending_verification user)
router.post('/resend-otp', resendOtpRateLimiter, validate(resendOtpSchema), AuthController.resendOtp);

// POST /api/v1/auth/register-device  (mobile app: store FCM token, switch notif_channel to 'app')
router.post('/register-device', authenticate, validate(registerDeviceSchema), AuthController.registerDevice);

// DELETE /api/v1/auth/register-device  (mobile app: remove FCM token for this device)
router.delete('/register-device', authenticate, AuthController.unregisterDevice);

// GET /api/v1/auth/sessions  (list active sessions for the authenticated user)
router.get('/sessions', authenticate, AuthController.listSessions);

// DELETE /api/v1/auth/sessions/:id  (revoke a specific session)
router.delete('/sessions/:id', authenticate, AuthController.revokeSession);

export default router;
