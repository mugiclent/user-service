import type { AuthenticatedUser } from '../models/index.js';

declare global {
  namespace Express {
    // req.user set by authenticate middleware from gateway-injected headers
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthenticatedUser {}
  }
}

export {};
