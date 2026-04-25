import Joi from 'joi';
import { phoneSchema } from '../../utils/phone.js';

const patternItem = Joi.string()
  .trim()
  .max(80)
  .pattern(/^[\w*][\w_*]*:[\w*]+:(own|org|platform)$/)
  .message('pattern must be subject:action:scope where scope is own, org, or platform');

const password = Joi.string().min(8).max(128);

export const updateMeSchema = Joi.object({
  first_name: Joi.string().trim().max(100).optional(),
  last_name: Joi.string().trim().max(100).optional(),
  phone_number: phoneSchema.optional(),
  email: Joi.string().trim().email().max(255).optional(),
  avatar_path: Joi.string().max(500).optional().allow(null),
  notif_channel: Joi.array().items(Joi.string().valid('sms', 'email', 'app')).min(1).unique().optional(),
  locale: Joi.string().valid('rw', 'en', 'fr').optional(),
  two_factor_enabled: Joi.boolean().optional(),
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
  role_slugs: Joi.array().items(Joi.string().trim()).min(1).required(),
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

// Request a login-channel change or identifier update.
// - channel only: switch login_channel to an already-verified channel (phone ↔ email)
// - channel + identifier: change the actual phone/email value and make it the login_channel
export const loginChannelSchema = Joi.object({
  channel: Joi.string().valid('phone', 'email').required(),
  identifier: Joi.when('channel', {
    is: 'email',
    then: Joi.string().trim().email().max(255).optional(),
    otherwise: phoneSchema.optional(),
  }),
});

// Confirm a login-channel change — channel + OTP only. Identifier is read from server-side pending state.
export const loginChannelConfirmSchema = Joi.object({
  channel: Joi.string().valid('phone', 'email').required(),
  otp: Joi.string().trim().length(6).required(),
});

export const updateInvitationSchema = Joi.object({
  first_name: Joi.string().trim().max(100).optional(),
  last_name: Joi.string().trim().max(100).optional(),
  email: Joi.string().trim().email().max(255).optional(),
  phone_number: phoneSchema.optional(),
  role_slugs: Joi.array().items(Joi.string().trim()).min(1).optional(),
  locale: Joi.string().valid('rw', 'en', 'fr').optional(),
}).min(1);

export const addUserGrantsSchema = Joi.object({
  patterns: Joi.array().items(patternItem).min(1).required(),
});
