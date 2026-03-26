import type { Request, Response, NextFunction } from 'express';
import type Joi from 'joi';
import { AppError } from '../utils/AppError.js';

export const validate =
  (schema: Joi.ObjectSchema) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) return next(new AppError('VALIDATION_ERROR', 422, error.details));
    req.body = value;
    next();
  };
