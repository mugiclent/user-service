import { Router } from 'express';
import { OrgController } from './org.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { uploadImage } from '../middleware/upload.js';
import { createOrgSchema, updateOrgSchema } from '../middleware/schemas/org.schema.js';

const router = Router();

// POST /api/v1/organizations
router.post('/', authenticate, authorize('create', 'Org'), validate(createOrgSchema), OrgController.createOrg);

// GET /api/v1/organizations
router.get('/', authenticate, authorize('read', 'Org'), OrgController.listOrgs);

// GET /api/v1/organizations/me  (must be before /:id — no authorize, every org staff accesses own org)
router.get('/me', authenticate, OrgController.getMyOrg);

// GET /api/v1/organizations/:id
router.get('/:id', authenticate, authorize('read', 'Org'), OrgController.getOrgById);

// PATCH /api/v1/organizations/:id
router.patch('/:id', authenticate, authorize('update', 'Org'), validate(updateOrgSchema), OrgController.updateOrg);

// POST /api/v1/organizations/:id/approve
router.post('/:id/approve', authenticate, authorize('update', 'Org'), OrgController.approveChildOrg);

// POST /api/v1/organizations/:id/logo
router.post('/:id/logo', authenticate, authorize('update', 'Org'), uploadImage('logo'), OrgController.uploadLogo);

// DELETE /api/v1/organizations/:id/logo
router.delete('/:id/logo', authenticate, authorize('update', 'Org'), OrgController.deleteLogo);

export default router;
