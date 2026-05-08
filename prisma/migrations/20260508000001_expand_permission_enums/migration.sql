-- Extend PermissionAction enum
ALTER TYPE "PermissionAction" ADD VALUE IF NOT EXISTS 'manage';
ALTER TYPE "PermissionAction" ADD VALUE IF NOT EXISTS 'cancel';
ALTER TYPE "PermissionAction" ADD VALUE IF NOT EXISTS 'refund';
ALTER TYPE "PermissionAction" ADD VALUE IF NOT EXISTS 'topup';
ALTER TYPE "PermissionAction" ADD VALUE IF NOT EXISTS 'pay';
ALTER TYPE "PermissionAction" ADD VALUE IF NOT EXISTS 'override';
ALTER TYPE "PermissionAction" ADD VALUE IF NOT EXISTS 'read_manifest';

-- Extend PermissionSubject enum
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Permission';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Trip';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Route';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Location';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Bus';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Ticket';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Price';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Wallet';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Payment';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Refund';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Payout';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Finance';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Billing';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Commission';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'TaxReceipt';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Vsdc';
ALTER TYPE "PermissionSubject" ADD VALUE IF NOT EXISTS 'Report';
