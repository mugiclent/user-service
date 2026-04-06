import Joi from 'joi';

const patternItem = Joi.string()
  .trim()
  .max(80)
  .pattern(/^[\w*][\w_*]*:[\w*]+:(own|org|platform)$/)
  .message('pattern must be subject:action:scope where scope is own, org, or platform');

export const createRoleSchema = Joi.object({
  name: Joi.string().trim().max(100).required(),
  slug: Joi.string().trim().lowercase().max(100).pattern(/^[a-z0-9-]+$/).optional(),
  org_id: Joi.string().uuid().optional(),
  patterns: Joi.array().items(patternItem).min(1).required(),
});

export const updateRoleSchema = Joi.object({
  name: Joi.string().trim().max(100).required(),
});

export const addGrantSchema = Joi.object({
  pattern: patternItem.required(),
});
