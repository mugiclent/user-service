import type { AuthenticatedUser } from '../models/index.js';

declare global {
  namespace Express {
    // req.user set by Passport JWT strategy — has Prisma User + user_roles + CASL rules
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthenticatedUser {}
  }
}

export {};
