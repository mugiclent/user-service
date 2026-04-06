// Route declarations — excluded from unit test coverage (see vitest.config.ts)
import { Router } from 'express';
import { PermissionController } from './permission.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

// GET /api/v1/permissions — any staff with role:read access can view the catalog
router.get('/', authenticate, authorize('read', 'Role'), PermissionController.listPermissions);

export default router;
