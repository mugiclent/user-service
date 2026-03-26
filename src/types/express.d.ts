import type { User } from '@prisma/client';
import type { RawRuleOf } from '@casl/ability';
import type { AppAbility } from '../utils/ability.js';

declare global {
  namespace Express {
    // req.user set by Passport JWT strategy
    interface User extends import('@prisma/client').User {
      rules: RawRuleOf<AppAbility>[];
    }
  }
}

export {};
