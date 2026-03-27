import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config/index.js';
import type { AppRule } from '../utils/ability.js';

const adapter = new PrismaPg({ connectionString: config.db.url });
export const prisma = new PrismaClient({ adapter });

// Re-export Prisma types used across the service
export type { User, Org, Role, UserRole, Permission, RolePermission, UserPermission, RefreshToken, Otp, Invitation } from '@prisma/client';
export { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Composite types
// ---------------------------------------------------------------------------

export type UserWithRoles = import('@prisma/client').Prisma.UserGetPayload<{
  include: {
    user_roles: {
      include: {
        role: {
          include: {
            role_permissions: { include: { permission: true } };
          };
        };
      };
    };
    user_permissions: { include: { permission: true } };
  };
}>;

/**
 * Slim identity set on req.user by the authenticate middleware.
 * Populated from gateway-injected headers — no DB hit per request.
 * Services fetch the full Prisma record when they actually need it.
 */
export interface AuthenticatedUser {
  id: string;
  org_id: string | null;
  user_type: 'passenger' | 'staff';
  /** Role slugs from the JWT — used for admin/org-scope checks without a DB query. */
  role_slugs: string[];
  /** Unpacked CASL rules from the JWT. */
  rules: AppRule[];
}
