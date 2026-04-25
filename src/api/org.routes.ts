// Route declarations — excluded from unit test coverage (see vitest.config.ts)
import { Router } from 'express';
import { OrgController } from './org.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { createOrgSchema, updateOrgSchema } from '../middleware/schemas/org.schema.js';

const router = Router();

// POST /api/v1/organizations  (admin only)
router.post('/', authenticate, authorize('create', 'Org'), validate(createOrgSchema), OrgController.createOrg);

// GET /api/v1/organizations
router.get('/', authenticate, authorize('read', 'Org'), OrgController.listOrgs);

// GET /api/v1/organizations/me  (must be before /:id — no authorize, every org staff accesses own org)
router.get('/me', authenticate, OrgController.getMyOrg);

// GET /api/v1/organizations/me/logo/presigned-url?content_type=image/jpeg
// org_admin uploads their own org's logo via presigned URL
router.get('/me/logo/presigned-url', authenticate, authorize('update', 'Org'), OrgController.getLogoPresignedUrl);

// GET /api/v1/organizations/:id
router.get('/:id', authenticate, authorize('read', 'Org'), OrgController.getOrgById);

// PATCH /api/v1/organizations/:id  (also accepts logo_path to commit a presigned upload, or null to delete)
router.patch('/:id', authenticate, authorize('update', 'Org'), validate(updateOrgSchema), OrgController.updateOrg);

// POST /api/v1/organizations/:id/cooperative-approve  (cooperative staff approves a coop_member)
router.post('/:id/cooperative-approve', authenticate, authorize('approve', 'Org'), OrgController.cooperativeApprove);

// POST /api/v1/organizations/:id/cooperative-reject  (cooperative staff rejects a coop_member)
router.post('/:id/cooperative-reject', authenticate, authorize('approve', 'Org'), OrgController.cooperativeReject);

// GET /api/v1/organizations/:id/logo/presigned-url?content_type=image/jpeg
// platform admin uploads a logo for any org
router.get('/:id/logo/presigned-url', authenticate, authorize('update', 'Org'), OrgController.getLogoPresignedUrl);

export default router;
