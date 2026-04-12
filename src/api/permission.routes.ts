// Route declarations — excluded from unit test coverage (see vitest.config.ts)
import { Router } from 'express';
import { PermissionController } from './permission.controller.js';
import { authenticate, requireStaff } from '../middleware/authenticate.js';

const router = Router();

// GET /api/v1/permissions — staff-only; passengers cannot access the catalog
router.get('/', authenticate, requireStaff, PermissionController.listPermissions);

export default router;
