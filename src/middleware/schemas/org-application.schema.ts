import Joi from 'joi';

export const applyOrgSchema = Joi.object({
  name: Joi.string().trim().max(200).required(),
  org_type: Joi.string().valid('company', 'cooperative').required(),
  contact_email: Joi.string().trim().email().max(255).required(),
  contact_phone: Joi.string().trim().pattern(/^\+\d{7,15}$/).required(),
  address: Joi.string().trim().max(500).optional(),
  tin: Joi.string().trim().max(50).optional(),
  license_number: Joi.string().trim().max(100).optional(),
  parent_org_id: Joi.string().uuid().optional(),
  business_certificate_path: Joi.string().trim().max(500).required(),
  rep_id_path: Joi.string().trim().max(500).required(),
});

export const verifyOrgContactSchema = Joi.object({
  org_id: Joi.string().uuid().required(),
  otp: Joi.string().trim().length(6).required(),
});
