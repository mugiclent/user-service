import Joi from 'joi';

const phone = Joi.string().trim().pattern(/^\+\d{7,15}$/).messages({
  'string.pattern.base': 'Phone number must be in E.164 format (e.g. +250788000000)',
});

const password = Joi.string().min(8).max(128);

export const loginSchema = Joi.object({
  identifier: Joi.string().trim().required(),
  password: password.required(),
  device_name: Joi.string().trim().max(200).optional(),
});

export const registerSchema = Joi.object({
  first_name: Joi.string().trim().max(100).required(),
  last_name: Joi.string().trim().max(100).required(),
  phone_number: phone.required(),
  email: Joi.string().trim().email().max(255).optional(),
  password: password.required(),
});

export const verifyPhoneSchema = Joi.object({
  user_id: Joi.string().uuid().required(),
  otp: Joi.string().trim().length(6).required(),
});

export const forgotPasswordSchema = Joi.object({
  identifier: Joi.string().trim().required(),
});

export const resetPasswordSchema = Joi.object({
  token: Joi.string().trim().required(),
  new_password: password.required(),
});
