import express from 'express';
import type { Application } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import passport from 'passport';
import authRouter from '../api/auth.routes.js';
import userRouter from '../api/user.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

export const createApp = (): Application => {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS — tighten origins per environment in production
  app.use(cors({ origin: true, credentials: true }));

  // Body parsing
  app.use(express.json());
  app.use(cookieParser());

  // Auth
  app.use(passport.initialize());

  // Routes
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', userRouter);

  // Global error handler — must be last
  app.use(errorHandler);

  return app;
};
