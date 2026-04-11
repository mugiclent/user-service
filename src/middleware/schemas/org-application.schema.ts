import Joi from 'joi';
import { phoneSchema, tinSchema } from '../../utils/phone.js';

export const applyOrgSchema = Joi.object({
  name: Joi.string().trim().max(200).required(),
  org_type: Joi.string().valid('company', 'cooperative').required(),
  contact_email: Joi.string().trim().email().max(255).required(),
  contact_phone: phoneSchema.required(),
  address: Joi.string().trim().max(500).optional(),
  tin: tinSchema.required(),
  license_number: Joi.string().trim().max(100).optional(),
  parent_org_id: Joi.string().uuid().optional(),
  business_certificate_path: Joi.string().trim().max(500).required(),
  rep_id_path: Joi.string().trim().max(500).required(),
});

export const verifyOrgContactSchema = Joi.object({
  org_id: Joi.string().uuid().required(),
  otp: Joi.string().trim().length(6).required(),
});
