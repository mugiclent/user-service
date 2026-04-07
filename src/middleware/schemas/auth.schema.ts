import Joi from 'joi';
import { phoneSchema } from '../../utils/phone.js';

const phone = phoneSchema;

const password = Joi.string().min(8).max(128);

export const loginSchema = Joi.object({
  identifier: Joi.string().trim().required(),
  password: password.required(),
  device_name: Joi.string().trim().max(200).optional(),
});

// Passengers only — email is optional (staff are created via invite)
export const registerSchema = Joi.object({
  first_name: Joi.string().trim().max(100).required(),
  last_name: Joi.string().trim().max(100).required(),
  phone_number: phone.required(),
  email: Joi.string().trim().email().lowercase().max(255).optional(),
  locale: Joi.string().valid('rw', 'en', 'fr').optional(),
  password: password.required(),
});

export const verifyPhoneSchema = Joi.object({
  user_id: Joi.string().uuid().required(),
  otp: Joi.string().trim().length(6).required(),
  device_name: Joi.string().trim().max(200).optional(),
});

// Step-2 of login when two_factor_enabled = true
export const verify2faSchema = Joi.object({
  user_id: Joi.string().uuid().required(),
  otp: Joi.string().trim().length(6).required(),
  device_name: Joi.string().trim().max(200).optional(),
});

export const forgotPasswordSchema = Joi.object({
  identifier: Joi.string().trim().required(),
});

export const resetPasswordSchema = Joi.object({
  identifier: Joi.string().trim().required(),
  otp: Joi.string().trim().length(6).required(),
  new_password: password.required(),
});

export const registerDeviceSchema = Joi.object({
  fcm_token: Joi.string().trim().max(500).required(),
});

export const resendOtpSchema = Joi.object({
  user_id: Joi.string().uuid().required(),
});
