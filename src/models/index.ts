import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';
import type { AppRule } from '../utils/ability.js';

export const prisma = new PrismaClient({
  datasources: { db: { url: config.db.url } },
});

// Re-export Prisma types used across the service
export type { User, Org, Role, UserRole, RefreshToken, Otp, PasswordReset, Invitation } from '@prisma/client';
export { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Composite types
// ---------------------------------------------------------------------------

export type UserWithRoles = import('@prisma/client').Prisma.UserGetPayload<{
  include: { user_roles: { include: { role: true } } };
}>;

/** UserWithRoles extended with CASL rules from the JWT (set by Passport strategy). */
export type AuthenticatedUser = UserWithRoles & { rules: AppRule[] };
