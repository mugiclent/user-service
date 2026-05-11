import Joi from 'joi';
import { phoneSchema, tinSchema } from '../../utils/phone.js';
import { accountNumberSchema } from './bank.schema.js';

export const createOrgSchema = Joi.object({
  name: Joi.string().trim().max(200).required(),
  org_type: Joi.string().valid('company', 'cooperative', 'coop_member').required(),
  contact_first_name: Joi.string().trim().max(100).required(),
  contact_last_name: Joi.string().trim().max(100).required(),
  contact_email: Joi.string().trim().email().max(255).required(),
  contact_phone: phoneSchema.required(),
  address: Joi.string().trim().max(500).optional(),
  tin: tinSchema.required(),
  license_number: Joi.string().trim().max(100).optional(),
  parent_org_id: Joi.string().uuid().optional(),
  story: Joi.string().trim().max(5000).optional().allow('', null),
  status: Joi.string().valid('active', 'pending', 'suspended').optional(),
});

export const updateOrgSchema = Joi.object({
  name: Joi.string().trim().max(200).optional(),
  contact_first_name: Joi.string().trim().max(100).optional(),
  contact_last_name: Joi.string().trim().max(100).optional(),
  contact_email: Joi.string().trim().email().max(255).optional(),
  contact_phone: phoneSchema.optional(),
  address: Joi.string().trim().max(500).optional(),
  logo_path: Joi.string().max(500).optional().allow(null),
  story: Joi.string().trim().max(5000).optional().allow('', null),
  cancellations_allowed: Joi.boolean().optional(),
  status: Joi.string().valid('active', 'suspended', 'rejected').optional(),
  rejection_reason: Joi.string().trim().max(1000).optional(),
  bank_id: Joi.string().uuid().optional().allow(null),
  account_number: accountNumberSchema,
}).min(1);
