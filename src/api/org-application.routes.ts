// Route declarations — excluded from unit test coverage (see vitest.config.ts)
import { Router } from 'express';
import { OrgApplicationController } from './org-application.controller.js';
import { validate } from '../middleware/validate.js';
import {
  applyOrgSchema,
  verifyOrgContactSchema,
} from '../middleware/schemas/org-application.schema.js';

const router = Router();

// GET /api/v1/organizations/apply/documents/presigned-url?doc_type=...&content_type=...
// Public: generate a presigned PUT URL for an org application document upload
// (query param validation handled in controller)
router.get('/apply/documents/presigned-url', OrgApplicationController.getDocumentPresignedUrl);

// POST /api/v1/organizations/apply
// Public: submit an org application (doc paths already uploaded)
router.post('/apply', validate(applyOrgSchema), OrgApplicationController.apply);

// POST /api/v1/organizations/verify-contact
// Public: verify the email OTP sent during application
router.post('/verify-contact', validate(verifyOrgContactSchema), OrgApplicationController.verifyContact);

export default router;
