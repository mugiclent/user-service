import Joi from 'joi';

// amount + phone are validated in the service so they surface the contract's
// INVALID_AMOUNT (400) / INVALID_PHONE (422) codes rather than a generic 422.
export const initiateTopupSchema = Joi.object({
  amount: Joi.number().required(),
  phone: Joi.string().trim().optional(),
  payment_method: Joi.string().valid('mtn', 'airtel').required(),
});
