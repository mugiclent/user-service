// Route declarations — excluded from unit test coverage (see vitest.config.ts)
import { Router } from 'express';
import { BankController } from './bank.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { createBankSchema, updateBankSchema } from '../middleware/schemas/bank.schema.js';

const router = Router();

// GET /api/v1/banks — public list of banks
router.get('/', BankController.list);

// POST /api/v1/banks — platform staff only
router.post('/', authenticate, authorize('manage', 'Org'), validate(createBankSchema), BankController.create);

// PATCH /api/v1/banks/:id — platform staff only
router.patch('/:id', authenticate, authorize('manage', 'Org'), validate(updateBankSchema), BankController.update);

// DELETE /api/v1/banks/:id — platform staff only (soft delete)
router.delete('/:id', authenticate, authorize('manage', 'Org'), BankController.softDelete);

export default router;
