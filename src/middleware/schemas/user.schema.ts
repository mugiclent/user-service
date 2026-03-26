import Joi from 'joi';

export const updateMeSchema = Joi.object({
  first_name: Joi.string().trim().max(100).optional(),
  last_name: Joi.string().trim().max(100).optional(),
  email: Joi.string().trim().email().max(255).optional(),
  avatar_url: Joi.string().uri().max(500).optional(),
}).min(1);
