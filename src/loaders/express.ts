import { createPublicKey } from 'node:crypto';
import express from 'express';
import type { Application, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from '../config/index.js';
import authRouter from '../api/auth.routes.js';
import userRouter from '../api/user.routes.js';
import orgRouter from '../api/org.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createSwaggerRouter } from './swagger.js';

export const createApp = (): Application => {
  const app = express();

  // Tell Express how many proxy hops to trust for req.ip / req.protocol.
  // Set TRUST_PROXY=1 when behind one gateway/load-balancer (default).
  // Set to 0 only in local development without a proxy.
  app.set('trust proxy', config.trustProxy);

  // API docs — must be registered BEFORE helmet() so that swagger-ui's inline
  // scripts are not blocked by the default Content-Security-Policy header.
  // Disabled in production.
  if (!config.isProd) {
    app.use('/api/v1/users/docs', createSwaggerRouter());
  }

  // Security headers — kept even behind a gateway (defense-in-depth)
  app.use(helmet());

  // CORS: handled by the API gateway in production.
  // Enabled here only for local development / direct-access environments.
  if (!config.isProd) {
    app.use(cors({ origin: true, credentials: true }));
  }

  // Body parsing
  app.use(express.json());
  app.use(cookieParser());

  // Health check — unauthenticated, for gateway / load-balancer probes
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // JWKS endpoint — exposes RS256 public key so the API gateway and other
  // microservices can verify access tokens without contacting this service.
  const jwk = createPublicKey(config.jwt.publicKey).export({ format: 'jwk' }) as Record<string, unknown>;
  app.get('/.well-known/jwks.json', (_req: Request, res: Response) => {
    res.json({ keys: [{ ...jwk, use: 'sig', alg: 'RS256', kid: 'katisha-user-service-1' }] });
  });

  // Routes
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', userRouter);
  app.use('/api/v1/organizations', orgRouter);

  // Global error handler — must be last
  app.use(errorHandler);

  return app;
};
