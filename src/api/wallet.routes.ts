// Route declarations — excluded from unit test coverage (see vitest.config.ts)
import { Router } from 'express';
import { WalletController } from './wallet.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { initiateTopupSchema } from '../middleware/schemas/wallet.schema.js';

const router = Router();

// GET /api/v1/users/me/wallet  — local wallet balance
router.get('/me/wallet', authenticate, WalletController.getWallet);

// POST /api/v1/users/me/wallet/topup  — initiate a wallet top-up via MoMo
router.post('/me/wallet/topup', authenticate, validate(initiateTopupSchema), WalletController.initiateTopup);

// GET /api/v1/users/me/wallet/topup/:id/stream  — SSE stream for topup status
router.get('/me/wallet/topup/:id/stream', authenticate, WalletController.streamTopup);

// GET /api/v1/users/me/wallet/transactions  — own transaction history (proxied to payment-svc)
router.get('/me/wallet/transactions', authenticate, WalletController.getTransactions);

// GET /api/v1/users/:id/wallet/transactions  — admin view of any user's transactions
router.get('/:id/wallet/transactions', authenticate, authorize('read', 'User'), WalletController.getUserTransactions);

export default router;
