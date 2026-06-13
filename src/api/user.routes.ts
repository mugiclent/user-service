// Route declarations — excluded from unit test coverage (see vitest.config.ts)
import { Router } from 'express';
import { UserController } from './user.controller.js';
import { validate, validateQuery } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import {
  updateMeSchema,
  updateUserSchema,
  inviteUserSchema,
  acceptInviteSchema,
  validatePasswordSchema,
  changePasswordSchema,
  loginChannelSchema,
  loginChannelConfirmSchema,
  updateInvitationSchema,
  addUserGrantsSchema,
  assignRolesSchema,
  listUsersQuerySchema,
  setInvitationGrantsSchema,
} from '../middleware/schemas/user.schema.js';
import { sudoRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// POST /api/v1/users/invite  (must be before /:id)
router.post('/invite', authenticate, authorize('create', 'User'), validate(inviteUserSchema), UserController.inviteUser);

// POST /api/v1/users/accept-invite  (public — token is the credential)
router.post('/accept-invite', validate(acceptInviteSchema), UserController.acceptInvite);

// GET    /api/v1/users/invitations
router.get('/invitations', authenticate, authorize('invite', 'User'), UserController.listInvitations);

// GET    /api/v1/users/invitations/:id
router.get('/invitations/:id', authenticate, authorize('invite', 'User'), UserController.getInvitationById);

// PATCH  /api/v1/users/invitations/:id
router.patch('/invitations/:id', authenticate, authorize('invite', 'User'), validate(updateInvitationSchema), UserController.updateInvitation);

// PUT    /api/v1/users/invitations/:id/grants — replace direct grants (assign_role scope)
router.put('/invitations/:id/grants', authenticate, authorize('assign_role', 'User'), validate(setInvitationGrantsSchema), UserController.setInvitationGrants);

// POST   /api/v1/users/invitations/:id/resend
router.post('/invitations/:id/resend', authenticate, authorize('invite', 'User'), UserController.resendInvitation);

// DELETE /api/v1/users/invitations/:id
router.delete('/invitations/:id', authenticate, authorize('invite', 'User'), UserController.deleteInvitation);

// GET /api/v1/users/me/devices  (must be before /me to register as specific path)
router.get('/me/devices', authenticate, UserController.listMyDevices);

// GET /api/v1/users/me  (must be before /:id — no authorize, every authenticated user accesses own profile)
router.get('/me', authenticate, UserController.getMe);

// PATCH /api/v1/users/me  (also accepts avatar_path to commit a presigned upload, or null to delete)
// When body includes `password`, requires X-Sudo-Token with action 'change_password'.
// Use changePasswordSchema to validate password-only updates; otherwise updateMeSchema.
router.patch('/me', authenticate, (req, res, next) => {
  const hasPassword = typeof (req.body as Record<string, unknown>)['password'] === 'string';
  return validate(hasPassword ? changePasswordSchema : updateMeSchema)(req, res, next);
}, UserController.updateMe);

// POST /api/v1/users/me/validate-password — issues an action-scoped sudo token
router.post('/me/validate-password', authenticate, sudoRateLimiter, validate(validatePasswordSchema), UserController.validatePassword);

// DELETE /api/v1/users/me — self-delete, requires X-Sudo-Token with action 'delete_account'
router.delete('/me', authenticate, UserController.deleteSelf);

// POST /api/v1/users/me/login-channel  — request login channel switch (sends OTP)
router.post('/me/login-channel', authenticate, validate(loginChannelSchema), UserController.requestLoginChannelChange);

// POST /api/v1/users/me/login-channel/confirm  — confirm channel switch with OTP
router.post('/me/login-channel/confirm', authenticate, validate(loginChannelConfirmSchema), UserController.confirmLoginChannelChange);

// GET /api/v1/users/me/avatar/presigned-url?content_type=image/jpeg
router.get('/me/avatar/presigned-url', authenticate, UserController.getAvatarPresignedUrl);

// GET /api/v1/users
router.get('/', authenticate, authorize('read', 'User'), validateQuery(listUsersQuerySchema), UserController.listUsers);

// GET /api/v1/users/:id
router.get('/:id', authenticate, authorize('read', 'User'), UserController.getUserById);

// PATCH /api/v1/users/:id
router.patch('/:id', authenticate, authorize('update', 'User'), validate(updateUserSchema), UserController.updateUser);

// PUT /api/v1/users/:id/roles — replace a user's roles (assign_role scope; subset-guarded in service)
router.put('/:id/roles', authenticate, authorize('assign_role', 'User'), validate(assignRolesSchema), UserController.assignRoles);

// DELETE /api/v1/users/:id
router.delete('/:id', authenticate, authorize('delete', 'User'), UserController.deleteUser);

// POST /api/v1/users/:id/grants
router.post('/:id/grants', authenticate, authorize('assign_role', 'User'), validate(addUserGrantsSchema), UserController.addUserGrants);

// DELETE /api/v1/users/:id/grants/:grantId
router.delete('/:id/grants/:grantId', authenticate, authorize('assign_role', 'User'), UserController.removeUserGrant);

export default router;
