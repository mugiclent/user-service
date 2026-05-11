import Joi from 'joi';

export const createBankSchema = Joi.object({
  name: Joi.string().trim().max(100).required(),
});

export const updateBankSchema = Joi.object({
  name: Joi.string().trim().max(100).optional(),
  is_active: Joi.boolean().optional(),
}).min(1);

export const accountNumberSchema = Joi.string().pattern(/^\d{8,20}$/).optional().allow(null);
