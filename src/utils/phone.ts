import Joi from 'joi';
import { parsePhoneNumber } from 'libphonenumber-js';

const DEFAULT_REGION = 'RW';

/**
 * Normalizes any phone input to digits-only E.164 without the leading '+'.
 * Stored value is always: country code + subscriber number, e.g. '250780000001'.
 *
 * Accepted input formats (all resolve to the same number):
 *   +250780000001  — E.164 with +
 *    250780000001  — E.164 without +
 *   0780000001    — local format with trunk prefix (0)
 *    780000001    — bare subscriber number (defaults to RW +250)
 *   0031612345678 — 00-prefixed international (e.g. Dutch)
 *
 * Throws if the number is structurally invalid (e.g. +2500780000001).
 */
export const normalizePhone = (raw: string): string => {
  const trimmed = raw.trim().replace(/[\s\-().]/g, '');

  // Convert 00-prefixed international dialing to + form
  const withPlus = trimmed.startsWith('00')
    ? '+' + trimmed.slice(2)
    : trimmed.startsWith('+')
    ? trimmed
    : trimmed.startsWith('250')
    ? '+' + trimmed               // country code present, no +
    : trimmed.startsWith('0')
    ? '+250' + trimmed.slice(1)   // local trunk prefix
    : '+250' + trimmed;           // bare subscriber number, default to RW

  const parsed = parsePhoneNumber(withPlus, DEFAULT_REGION);

  if (!parsed.isValid()) {
    throw new Error(`Invalid phone number: ${raw}`);
  }

  // E.164 without '+': '250780000001'
  return parsed.format('E.164').slice(1);
};

/**
 * Prepend '+' to a stored phone number for display.
 * '250780000001' → '+250780000001'
 */
export const displayPhone = (stored: string): string => '+' + stored;

/**
 * Reusable Joi schema — normalizes to digits-only on validation.
 */
export const phoneSchema = Joi.string()
  .trim()
  .custom((value: string, helpers) => {
    try {
      return normalizePhone(value);
    } catch {
      return helpers.error('phone.invalid');
    }
  })
  .messages({
    'phone.invalid': 'Invalid phone number — provide a valid E.164 number or a local Rwandan number',
  });
