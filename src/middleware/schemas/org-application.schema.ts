import Joi from 'joi';
import { phoneSchema, tinSchema } from '../../utils/phone.js';

export const applyOrgSchema = Joi.object({
  name: Joi.string().trim().max(200).required(),
  org_type: Joi.string().valid('company', 'cooperative', 'coop_member').required(),
  contact_first_name: Joi.string().trim().max(100).required(),
  contact_last_name: Joi.string().trim().max(100).required(),
  contact_email: Joi.string().trim().email().max(255).required(),
  contact_phone: phoneSchema.required(),
  address: Joi.string().trim().max(500).optional(),
  tin: tinSchema.required(),
  license_number: Joi.string().trim().max(100).optional(),
  parent_org_id: Joi.when('org_type', {
    is: 'coop_member',
    then: Joi.string().uuid().required(),
    otherwise: Joi.string().uuid().optional(),
  }),
  business_certificate_path: Joi.string().trim().max(500).required(),
  rep_id_path: Joi.string().trim().max(500).required(),
  story: Joi.string().trim().max(5000).optional().allow('', null),
});

export const verifyOrgContactSchema = Joi.object({
  org_id: Joi.string().uuid().required(),
  otp: Joi.string().trim().length(6).required(),
  channel: Joi.string().valid('phone', 'email').required(),
});

export const resendOrgContactOtpSchema = Joi.object({
  org_id: Joi.string().uuid().required(),
  channel: Joi.string().valid('phone', 'email').required(),
});
