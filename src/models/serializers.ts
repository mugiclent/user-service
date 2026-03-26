import type { User } from '@prisma/client';
import type { AuthUser } from '../utils/sendAuthResponse.js';

/**
 * Strip sensitive and internal fields before sending a user to any client.
 * Always use this — never return a raw Prisma User object.
 */
export const serializeUser = (user: User): AuthUser => ({
  id: user.id,
  first_name: user.first_name,
  last_name: user.last_name,
  user_type: user.user_type,
  avatar_url: user.avatar_url,
  org_id: user.org_id,
  roles: [],        // populated from CASL rules — extended by service layer
  status: user.status,
});
