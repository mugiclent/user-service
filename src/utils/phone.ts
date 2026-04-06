import Joi from 'joi';

/**
 * Strips a leading '+' from a phone number string, leaving only digits.
 * Input: '+250788000001' → '250788000001'
 */
export const stripPhonePlus = (phone: string): string => phone.replace(/^\+/, '');

/**
 * Reusable Joi schema for phone numbers.
 * Accepts E.164 with or without the leading '+', trims whitespace,
 * strips the '+' if present, then validates that 7–15 digits remain.
 *
 * Stored value is always digits-only (no '+').
 */
export const phoneSchema = Joi.string()
  .trim()
  .custom((value: string) => stripPhonePlus(value))
  .pattern(/^\d{7,15}$/)
  .messages({
    'string.pattern.base': 'Phone number must contain 7–15 digits (E.164 format, + prefix optional)',
  });
