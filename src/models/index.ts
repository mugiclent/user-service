import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config/index.js';
import type { AppRule } from '../utils/ability.js';

const adapter = new PrismaPg({ connectionString: config.db.url });
export const prisma = new PrismaClient({ adapter });

// Re-export Prisma types used across the service
export type { User, Org, Role, UserRole, RefreshToken, Otp, Invitation } from '@prisma/client';
export { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Composite types
// ---------------------------------------------------------------------------

export type UserWithRoles = import('@prisma/client').Prisma.UserGetPayload<{
  include: { user_roles: { include: { role: true } } };
}>;

/** UserWithRoles extended with CASL rules from the JWT (set by Passport strategy). */
export type AuthenticatedUser = UserWithRoles & { rules: AppRule[] };
