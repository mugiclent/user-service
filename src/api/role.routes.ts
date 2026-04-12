// Route declarations — excluded from unit test coverage (see vitest.config.ts)
import { Router } from 'express';
import { RoleController } from './role.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireStaff } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { createRoleSchema, updateRoleSchema, addGrantSchema } from '../middleware/schemas/role.schema.js';

const router = Router();

// GET /api/v1/roles — staff-only; passengers cannot browse the role catalog
router.get('/', authenticate, requireStaff, RoleController.listRoles);

// POST /api/v1/roles
router.post('/', authenticate, authorize('create', 'Role'), validate(createRoleSchema), RoleController.createRole);

// GET /api/v1/roles/:id — staff-only; scoped in service
router.get('/:id', authenticate, requireStaff, RoleController.getRoleById);

// PATCH /api/v1/roles/:id
router.patch('/:id', authenticate, authorize('update', 'Role'), validate(updateRoleSchema), RoleController.updateRole);

// DELETE /api/v1/roles/:id
router.delete('/:id', authenticate, authorize('delete', 'Role'), RoleController.deleteRole);

// POST /api/v1/roles/:id/grants
router.post('/:id/grants', authenticate, authorize('update', 'Role'), validate(addGrantSchema), RoleController.addGrant);

// DELETE /api/v1/roles/:id/grants/:grantId
router.delete('/:id/grants/:grantId', authenticate, authorize('update', 'Role'), RoleController.removeGrant);

export default router;
