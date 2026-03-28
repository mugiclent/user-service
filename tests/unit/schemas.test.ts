/**
 * Tests for all Joi validation schemas
 */
import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  registerSchema,
  verifyPhoneSchema,
  verify2faSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  registerDeviceSchema,
} from '../../src/middleware/schemas/auth.schema.js';
import {
  updateMeSchema,
  updateUserSchema,
  inviteUserSchema,
  acceptInviteSchema,
  validatePasswordSchema,
  toggle2faSchema,
} from '../../src/middleware/schemas/user.schema.js';
import {
  createOrgSchema,
  updateOrgSchema,
} from '../../src/middleware/schemas/org.schema.js';
import {
  applyOrgSchema,
  verifyOrgContactSchema,
} from '../../src/middleware/schemas/org-application.schema.js';

const ok = (schema: { validate: (v: unknown) => { error?: unknown } }, value: unknown) =>
  expect(schema.validate(value).error).toBeUndefined();

const fail = (schema: { validate: (v: unknown) => { error?: unknown } }, value: unknown) =>
  expect(schema.validate(value).error).toBeDefined();

// ── Auth schemas ───────────────────────────────────────────────────────────────

describe('loginSchema', () => {
  it('accepts valid credentials', () => ok(loginSchema, { identifier: 'u@e.com', password: 'password123' }));
  it('rejects missing identifier', () => fail(loginSchema, { password: 'password123' }));
  it('rejects password shorter than 8 chars', () => fail(loginSchema, { identifier: 'u', password: 'short' }));
  it('accepts optional device_name', () => ok(loginSchema, { identifier: 'u', password: 'password123', device_name: 'iPhone' }));
});

describe('registerSchema', () => {
  it('accepts valid registration', () => ok(registerSchema, { first_name: 'A', last_name: 'B', phone_number: '+250788000001', password: 'password123' }));
  it('rejects invalid phone format', () => fail(registerSchema, { first_name: 'A', last_name: 'B', phone_number: '0788000001', password: 'password123' }));
  it('rejects missing first_name', () => fail(registerSchema, { last_name: 'B', phone_number: '+250788000001', password: 'pass' }));
});

describe('verifyPhoneSchema', () => {
  it('accepts valid payload', () => ok(verifyPhoneSchema, { user_id: '550e8400-e29b-41d4-a716-446655440000', otp: '123456' }));
  it('rejects non-UUID user_id', () => fail(verifyPhoneSchema, { user_id: 'not-a-uuid', otp: '123456' }));
  it('rejects otp != 6 chars', () => fail(verifyPhoneSchema, { user_id: '550e8400-e29b-41d4-a716-446655440000', otp: '12345' }));
});

describe('verify2faSchema', () => {
  it('accepts valid payload', () => ok(verify2faSchema, { user_id: '550e8400-e29b-41d4-a716-446655440000', otp: '654321' }));
});

describe('forgotPasswordSchema', () => {
  it('accepts identifier', () => ok(forgotPasswordSchema, { identifier: 'u@e.com' }));
  it('rejects empty', () => fail(forgotPasswordSchema, {}));
});

describe('resetPasswordSchema', () => {
  it('accepts valid payload', () => ok(resetPasswordSchema, { identifier: 'u@e.com', otp: '123456', new_password: 'NewPass123' }));
  it('rejects short password', () => fail(resetPasswordSchema, { identifier: 'u', otp: '123456', new_password: 'short' }));
});

describe('registerDeviceSchema', () => {
  it('accepts fcm_token', () => ok(registerDeviceSchema, { fcm_token: 'fcm-abc-123' }));
  it('rejects missing token', () => fail(registerDeviceSchema, {}));
});

// ── User schemas ───────────────────────────────────────────────────────────────

describe('updateMeSchema', () => {
  it('accepts partial update', () => ok(updateMeSchema, { first_name: 'Alice' }));
  it('accepts null avatar_path', () => ok(updateMeSchema, { avatar_path: null }));
  it('rejects empty object (min 1)', () => fail(updateMeSchema, {}));
  it('accepts valid notif_channel', () => ok(updateMeSchema, { notif_channel: 'all' }));
  it('rejects invalid notif_channel', () => fail(updateMeSchema, { notif_channel: 'carrier_pigeon' }));
});

describe('updateUserSchema', () => {
  it('accepts partial update', () => ok(updateUserSchema, { status: 'active' }));
  it('rejects empty object', () => fail(updateUserSchema, {}));
  it('rejects invalid status', () => fail(updateUserSchema, { status: 'deleted' }));
});

describe('inviteUserSchema', () => {
  it('accepts invite with email', () => ok(inviteUserSchema, { first_name: 'A', last_name: 'B', role_slug: 'org_admin', email: 'a@b.com' }));
  it('accepts invite with phone_number', () => ok(inviteUserSchema, { first_name: 'A', last_name: 'B', role_slug: 'org_admin', phone_number: '+250788000001' }));
  it('rejects when neither email nor phone_number', () => fail(inviteUserSchema, { first_name: 'A', last_name: 'B', role_slug: 'org_admin' }));
  it('rejects invalid phone format', () => fail(inviteUserSchema, { first_name: 'A', last_name: 'B', role_slug: 'r', phone_number: 'bad' }));
});

describe('acceptInviteSchema', () => {
  it('accepts valid invite acceptance', () => ok(acceptInviteSchema, { token: 'abc123', password: 'password123' }));
  it('rejects short password', () => fail(acceptInviteSchema, { token: 't', password: 'short' }));
});

describe('validatePasswordSchema', () => {
  it('accepts password >= 8 chars', () => ok(validatePasswordSchema, { password: 'validpass' }));
  it('rejects short password', () => fail(validatePasswordSchema, { password: 'short' }));
});

describe('toggle2faSchema', () => {
  it('accepts boolean enabled', () => ok(toggle2faSchema, { enabled: true }));
  it('accepts false', () => ok(toggle2faSchema, { enabled: false }));
  it('rejects non-boolean', () => fail(toggle2faSchema, { enabled: 'yes' }));
});

// ── Org schemas ────────────────────────────────────────────────────────────────

describe('createOrgSchema', () => {
  const base = { name: 'Acme', org_type: 'company', contact_email: 'a@b.com', contact_phone: '+250788000001' };
  it('accepts valid org creation', () => ok(createOrgSchema, base));
  it('rejects invalid org_type', () => fail(createOrgSchema, { ...base, org_type: 'partnership' }));
  it('rejects missing name', () => fail(createOrgSchema, { ...base, name: undefined }));
  it('accepts optional UUID parent_org_id', () => ok(createOrgSchema, { ...base, parent_org_id: '550e8400-e29b-41d4-a716-446655440000' }));
  it('rejects non-UUID parent_org_id', () => fail(createOrgSchema, { ...base, parent_org_id: 'not-uuid' }));
});

describe('updateOrgSchema', () => {
  it('accepts partial update', () => ok(updateOrgSchema, { name: 'New Name' }));
  it('rejects empty object', () => fail(updateOrgSchema, {}));
  it('accepts null logo_path', () => ok(updateOrgSchema, { logo_path: null }));
  it('rejects invalid status', () => fail(updateOrgSchema, { status: 'pending' }));
});

// ── Org application schemas ────────────────────────────────────────────────────

describe('applyOrgSchema', () => {
  const base = {
    name: 'Acme', org_type: 'company', contact_email: 'a@b.com',
    contact_phone: '+250788000001', business_certificate_path: 'org-docs/p/cert.pdf',
    rep_id_path: 'org-docs/p/id.jpg',
  };
  it('accepts valid application', () => ok(applyOrgSchema, base));
  it('rejects missing business_certificate_path', () => fail(applyOrgSchema, { ...base, business_certificate_path: undefined }));
  it('rejects invalid phone format', () => fail(applyOrgSchema, { ...base, contact_phone: '0788000001' }));
});

describe('verifyOrgContactSchema', () => {
  it('accepts valid payload', () => ok(verifyOrgContactSchema, { org_id: '550e8400-e29b-41d4-a716-446655440000', otp: '123456' }));
  it('rejects otp != 6 chars', () => fail(verifyOrgContactSchema, { org_id: '550e8400-e29b-41d4-a716-446655440000', otp: '12345' }));
  it('rejects non-UUID org_id', () => fail(verifyOrgContactSchema, { org_id: 'not-uuid', otp: '123456' }));
});
