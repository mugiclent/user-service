import { Router } from 'express';
import { OrgController } from './org.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { uploadImage } from '../middleware/upload.js';
import { createOrgSchema, updateOrgSchema } from '../middleware/schemas/org.schema.js';

const router = Router();

// POST /api/v1/organizations
router.post('/', authenticate, validate(createOrgSchema), OrgController.createOrg);

// GET /api/v1/organizations
router.get('/', authenticate, OrgController.listOrgs);

// GET /api/v1/organizations/me  (must be before /:id)
router.get('/me', authenticate, OrgController.getMyOrg);

// GET /api/v1/organizations/:id
router.get('/:id', authenticate, OrgController.getOrgById);

// PATCH /api/v1/organizations/:id
router.patch('/:id', authenticate, validate(updateOrgSchema), OrgController.updateOrg);

// POST /api/v1/organizations/:id/approve
router.post('/:id/approve', authenticate, OrgController.approveChildOrg);

// POST /api/v1/organizations/:id/logo
router.post('/:id/logo', authenticate, uploadImage('logo'), OrgController.uploadLogo);

// DELETE /api/v1/organizations/:id/logo
router.delete('/:id/logo', authenticate, OrgController.deleteLogo);

export default router;
