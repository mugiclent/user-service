import type { AuthenticatedUser } from '../models/index.js';

declare global {
  namespace Express {
    // req.user set by authenticate middleware from gateway-injected headers
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthenticatedUser {}

    // Extend Request directly so req.user is typed without @types/passport
    interface Request {
      user?: User;
    }
  }
}

export {};
