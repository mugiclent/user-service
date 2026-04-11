import Joi from 'joi';
import { phoneSchema } from '../../utils/phone.js';

const password = Joi.string().min(8).max(128);

export const updateMeSchema = Joi.object({
  first_name: Joi.string().trim().max(100).optional(),
  last_name: Joi.string().trim().max(100).optional(),
  email: Joi.string().trim().email().max(255).optional(),
  avatar_path: Joi.string().max(500).optional().allow(null),
  notif_channel: Joi.array().items(Joi.string().valid('sms', 'email', 'app')).min(1).unique().optional(),
}).min(1);

export const updateUserSchema = Joi.object({
  first_name: Joi.string().trim().max(100).optional(),
  last_name: Joi.string().trim().max(100).optional(),
  status: Joi.string().valid('active', 'suspended').optional(),
  org_id: Joi.string().uuid().optional(),
  role_slugs: Joi.array().items(Joi.string().trim()).optional(),
}).min(1);

export const inviteUserSchema = Joi.object({
  first_name: Joi.string().trim().max(100).required(),
  last_name: Joi.string().trim().max(100).required(),
  role_slug: Joi.string().trim().required(),
  org_id: Joi.string().uuid().optional(),
  email: Joi.string().trim().email().max(255).optional(),
  phone_number: phoneSchema.optional(),
  locale: Joi.string().valid('rw', 'en', 'fr').optional(),
}).or('email', 'phone_number');

export const acceptInviteSchema = Joi.object({
  token: Joi.string().trim().required(),
  password: password.required(),
  device_name: Joi.string().trim().max(200).optional(),
});

export const validatePasswordSchema = Joi.object({
  password: password.required(),
});

export const toggle2faSchema = Joi.object({
  enabled: Joi.boolean().required(),
});

export const loginChannelSchema = Joi.object({
  channel: Joi.string().valid('phone', 'email').required(),
});

export const loginChannelConfirmSchema = Joi.object({
  channel: Joi.string().valid('phone', 'email').required(),
  otp: Joi.string().trim().length(6).optional(),
});
