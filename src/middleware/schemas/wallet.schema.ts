import Joi from 'joi';
import { phoneSchema } from '../../utils/phone.js';

export const initiateTopupSchema = Joi.object({
  amount: Joi.number().integer().positive().max(5_000_000).required(),
  phone_number: phoneSchema.optional(),
  payment_method: Joi.string().valid('mtn', 'airtel').required(),
});
