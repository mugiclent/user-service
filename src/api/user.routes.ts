// Route declarations — excluded from unit test coverage (see vitest.config.ts)
import { Router } from 'express';
import { UserController } from './user.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import {
  updateMeSchema,
  updateUserSchema,
  inviteUserSchema,
  acceptInviteSchema,
  validatePasswordSchema,
  loginChannelSchema,
  loginChannelConfirmSchema,
  updateInvitationSchema,
  addUserGrantsSchema,
} from '../middleware/schemas/user.schema.js';

const router = Router();

// POST /api/v1/users/invite  (must be before /:id)
router.post('/invite', authenticate, authorize('create', 'User'), validate(inviteUserSchema), UserController.inviteUser);

// POST /api/v1/users/accept-invite  (public — token is the credential)
router.post('/accept-invite', validate(acceptInviteSchema), UserController.acceptInvite);

// GET    /api/v1/users/invitations
router.get('/invitations', authenticate, authorize('invite', 'User'), UserController.listInvitations);

// PATCH  /api/v1/users/invitations/:id
router.patch('/invitations/:id', authenticate, authorize('invite', 'User'), validate(updateInvitationSchema), UserController.updateInvitation);

// POST   /api/v1/users/invitations/:id/resend
router.post('/invitations/:id/resend', authenticate, authorize('invite', 'User'), UserController.resendInvitation);

// DELETE /api/v1/users/invitations/:id
router.delete('/invitations/:id', authenticate, authorize('invite', 'User'), UserController.deleteInvitation);

// GET /api/v1/users/me/devices  (must be before /me to register as specific path)
router.get('/me/devices', authenticate, UserController.listMyDevices);

// GET /api/v1/users/me  (must be before /:id — no authorize, every authenticated user accesses own profile)
router.get('/me', authenticate, UserController.getMe);

// PATCH /api/v1/users/me  (also accepts avatar_path to commit a presigned upload, or null to delete)
router.patch('/me', authenticate, validate(updateMeSchema), UserController.updateMe);

// POST /api/v1/users/me/validate-password
router.post('/me/validate-password', authenticate, validate(validatePasswordSchema), UserController.validatePassword);

// POST /api/v1/users/me/login-channel  — request login channel switch (sends OTP)
router.post('/me/login-channel', authenticate, validate(loginChannelSchema), UserController.requestLoginChannelChange);

// POST /api/v1/users/me/login-channel/confirm  — confirm channel switch with OTP
router.post('/me/login-channel/confirm', authenticate, validate(loginChannelConfirmSchema), UserController.confirmLoginChannelChange);

// GET /api/v1/users/me/avatar/presigned-url?content_type=image/jpeg
router.get('/me/avatar/presigned-url', authenticate, UserController.getAvatarPresignedUrl);

// GET /api/v1/users
router.get('/', authenticate, authorize('read', 'User'), UserController.listUsers);

// GET /api/v1/users/:id
router.get('/:id', authenticate, authorize('read', 'User'), UserController.getUserById);

// PATCH /api/v1/users/:id
router.patch('/:id', authenticate, authorize('update', 'User'), validate(updateUserSchema), UserController.updateUser);

// DELETE /api/v1/users/:id
router.delete('/:id', authenticate, authorize('delete', 'User'), UserController.deleteUser);

// POST /api/v1/users/:id/grants
router.post('/:id/grants', authenticate, authorize('assign_role', 'User'), validate(addUserGrantsSchema), UserController.addUserGrants);

// DELETE /api/v1/users/:id/grants/:grantId
router.delete('/:id/grants/:grantId', authenticate, authorize('assign_role', 'User'), UserController.removeUserGrant);

export default router;
