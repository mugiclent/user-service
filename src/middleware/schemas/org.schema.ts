import Joi from 'joi';

export const createOrgSchema = Joi.object({
  name: Joi.string().trim().max(200).required(),
  org_type: Joi.string().valid('company', 'cooperative').required(),
  contact_email: Joi.string().trim().email().max(255).required(),
  contact_phone: Joi.string().trim().max(20).required(),
  address: Joi.string().trim().max(500).optional(),
  tin: Joi.string().trim().max(50).optional(),
  license_number: Joi.string().trim().max(100).optional(),
  parent_org_id: Joi.string().uuid().optional(),
});

export const updateOrgSchema = Joi.object({
  name: Joi.string().trim().max(200).optional(),
  contact_email: Joi.string().trim().email().max(255).optional(),
  contact_phone: Joi.string().trim().max(20).optional(),
  address: Joi.string().trim().max(500).optional(),
  logo_path: Joi.string().max(500).optional().allow(null),
  status: Joi.string().valid('active', 'suspended', 'rejected').optional(),
  rejection_reason: Joi.string().trim().max(1000).optional(),
}).min(1);
