import { Router } from 'express';
import { UserController } from './user.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { uploadImage } from '../middleware/upload.js';
import {
  updateMeSchema,
  updateUserSchema,
  inviteUserSchema,
  acceptInviteSchema,
  validatePasswordSchema,
  toggle2faSchema,
} from '../middleware/schemas/user.schema.js';

const router = Router();

// POST /api/v1/users/invite  (must be before /:id)
router.post('/invite', authenticate, validate(inviteUserSchema), UserController.inviteUser);

// POST /api/v1/users/accept-invite  (public — token is the credential)
router.post('/accept-invite', validate(acceptInviteSchema), UserController.acceptInvite);

// GET /api/v1/users/me  (must be before /:id)
router.get('/me', authenticate, UserController.getMe);

// PATCH /api/v1/users/me
router.patch('/me', authenticate, validate(updateMeSchema), UserController.updateMe);

// POST /api/v1/users/me/validate-password
router.post('/me/validate-password', authenticate, validate(validatePasswordSchema), UserController.validatePassword);

// PATCH /api/v1/users/me/2fa
router.patch('/me/2fa', authenticate, validate(toggle2faSchema), UserController.toggle2fa);

// POST /api/v1/users/me/avatar
router.post('/me/avatar', authenticate, uploadImage('avatar'), UserController.uploadAvatar);

// DELETE /api/v1/users/me/avatar
router.delete('/me/avatar', authenticate, UserController.deleteAvatar);

// GET /api/v1/users
router.get('/', authenticate, UserController.listUsers);

// GET /api/v1/users/:id
router.get('/:id', authenticate, UserController.getUserById);

// PATCH /api/v1/users/:id
router.patch('/:id', authenticate, validate(updateUserSchema), UserController.updateUser);

// DELETE /api/v1/users/:id
router.delete('/:id', authenticate, UserController.deleteUser);

export default router;
