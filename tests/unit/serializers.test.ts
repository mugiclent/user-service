/**
 * Tests for src/models/serializers.ts
 */
import { describe, it, expect } from 'vitest';
import {
  serializeUserForAuth,
  serializeUserMe,
  maskPhone,
  serializeUserForList,
  serializeUserFullProfile,
  serializeOrgForList,
  serializeOrgCreated,
  serializeOrgFull,
} from '../../src/models/serializers.js';

// ── helpers ────────────────────────────────────────────────────────────────────

const now = new Date('2024-01-01T00:00:00Z');

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  first_name: 'Jane',
  last_name: 'Doe',
  phone_number: '+250788123456',
  phone_verified_at: now,
  email: 'jane@example.com',
  email_verified_at: now,
  password_hash: 'hash',
  user_type: 'staff' as const,
  status: 'active' as const,
  two_factor_enabled: false,
  avatar_path: null,
  notif_channel: 'sms' as const,
  fcm_token: null,
  org_id: 'org-1',
  driver_license_number: null,
  driver_license_verified_at: null,
  last_login_at: null,
  created_at: now,
  updated_at: now,
  deleted_at: null,
  user_roles: [{ role: { slug: 'org_admin', role_permissions: [] } }],
  user_permissions: [],
  ...overrides,
});

const makeOrg = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  name: 'Acme Bus',
  slug: 'acme-bus',
  org_type: 'company' as const,
  status: 'active' as const,
  tin: null,
  license_number: null,
  contact_email: 'ops@acme.com',
  contact_phone: '+250780000010',
  address: null,
  logo_path: null,
  parent_org_id: null,
  approved_by: 'admin-1',
  approved_at: now,
  rejection_reason: null,
  cooperative_approved_at: null,
  contact_email_verified_at: null,
  contact_otp_hash: null,
  contact_otp_expires_at: null,
  created_at: now,
  updated_at: now,
  deleted_at: null,
  parent_org: null,
  child_orgs: [],
  ...overrides,
});

// ── serializeUserForAuth ───────────────────────────────────────────────────────

describe('serializeUserForAuth', () => {
  it('returns id, name, user_type, avatar_path, org_id, roles, status, two_factor_enabled', () => {
    const dto = serializeUserForAuth(makeUser() as never);
    expect(dto).toMatchObject({
      id: 'user-1',
      first_name: 'Jane',
      last_name: 'Doe',
      user_type: 'staff',
      avatar_path: null,
      org_id: 'org-1',
      roles: ['org_admin'],
      status: 'active',
      two_factor_enabled: false,
    });
  });
});

// ── serializeUserMe ────────────────────────────────────────────────────────────

describe('serializeUserMe — passenger', () => {
  it('returns passenger shape (no roles/permissions)', () => {
    const user = makeUser({ user_type: 'passenger', org_id: null });
    const dto = serializeUserMe(user as never, []);
    expect(dto.user_type).toBe('passenger');
    expect(dto).toHaveProperty('phone_number');
    expect(dto).not.toHaveProperty('roles');
  });

  it('includes notif_channel', () => {
    const dto = serializeUserMe(makeUser({ user_type: 'passenger' }) as never, []);
    expect(dto).toHaveProperty('notif_channel');
  });
});

describe('serializeUserMe — staff', () => {
  it('returns staff shape with roles and permissions', () => {
    const rules = [{ action: 'read' as const, subject: 'User' as const }];
    const dto = serializeUserMe(makeUser() as never, rules) as Record<string, unknown>;
    expect(dto.user_type).toBe('staff');
    expect(dto.roles).toEqual(['org_admin']);
    expect(dto.permissions).toEqual(rules);
  });

  it('includes notif_channel', () => {
    const dto = serializeUserMe(makeUser() as never, []) as Record<string, unknown>;
    expect(dto).toHaveProperty('notif_channel');
  });
});

// ── maskPhone ─────────────────────────────────────────────────────────────────

describe('maskPhone', () => {
  it('masks to +250***456 format', () => {
    expect(maskPhone('+250788123456')).toBe('+250***456');
  });

  it('returns phone unchanged when 6 chars or fewer', () => {
    expect(maskPhone('+1234')).toBe('+1234');
    expect(maskPhone('123456')).toBe('123456');
  });
});

// ── serializeUserForList ──────────────────────────────────────────────────────

describe('serializeUserForList', () => {
  it('masks phone for non-admin', () => {
    const dto = serializeUserForList(makeUser() as never, false) as Record<string, unknown>;
    expect(dto.phone_number).toBe(maskPhone('+250788123456'));
  });

  it('shows full phone for admin', () => {
    const dto = serializeUserForList(makeUser() as never, true) as Record<string, unknown>;
    expect(dto.phone_number).toBe('+250788123456');
  });

  it('includes last_login_at for admin only', () => {
    const admin = serializeUserForList(makeUser() as never, true) as Record<string, unknown>;
    const nonAdmin = serializeUserForList(makeUser() as never, false) as Record<string, unknown>;
    expect(admin).toHaveProperty('last_login_at');
    expect(nonAdmin).not.toHaveProperty('last_login_at');
  });

  it('returns null phone_number when user has none', () => {
    const user = makeUser({ phone_number: null });
    const dto = serializeUserForList(user as never, false) as Record<string, unknown>;
    expect(dto.phone_number).toBeNull();
  });
});

// ── serializeUserFullProfile ──────────────────────────────────────────────────

describe('serializeUserFullProfile', () => {
  it('includes driver fields for admin', () => {
    const user = makeUser({ driver_license_number: 'DL-123', last_login_at: now });
    const dto = serializeUserFullProfile(user as never, true) as Record<string, unknown>;
    expect(dto).toHaveProperty('driver_license_number', 'DL-123');
    expect(dto).toHaveProperty('last_login_at', now);
  });

  it('excludes driver fields for non-admin', () => {
    const dto = serializeUserFullProfile(makeUser() as never, false) as Record<string, unknown>;
    expect(dto).not.toHaveProperty('driver_license_number');
    expect(dto).not.toHaveProperty('last_login_at');
  });
});

// ── serializeOrgForList ────────────────────────────────────────────────────────

describe('serializeOrgForList', () => {
  it('returns basic org list fields', () => {
    const dto = serializeOrgForList(makeOrg() as never);
    expect(dto).toMatchObject({ id: 'org-1', name: 'Acme Bus', slug: 'acme-bus', status: 'active' });
  });
});

// ── serializeOrgCreated ────────────────────────────────────────────────────────

describe('serializeOrgCreated', () => {
  it('returns created org fields (no logo_path, no approved_at)', () => {
    const dto = serializeOrgCreated(makeOrg() as never);
    expect(dto).toHaveProperty('id');
    expect(dto).toHaveProperty('status');
    expect(dto).not.toHaveProperty('logo_path');
    expect(dto).not.toHaveProperty('approved_at');
  });
});

// ── serializeOrgFull ──────────────────────────────────────────────────────────

describe('serializeOrgFull', () => {
  it('includes child_orgs and approved_by for admin', () => {
    const org = makeOrg({ child_orgs: [{ id: 'child-1', name: 'Child', slug: 'child', status: 'active' }] });
    const dto = serializeOrgFull(org as never, true) as Record<string, unknown>;
    expect(dto).toHaveProperty('child_orgs');
    expect(dto).toHaveProperty('approved_by', 'admin-1');
  });

  it('excludes child_orgs and approved_by for non-admin', () => {
    const dto = serializeOrgFull(makeOrg() as never, false) as Record<string, unknown>;
    expect(dto).not.toHaveProperty('child_orgs');
    expect(dto).not.toHaveProperty('approved_by');
  });

  it('always includes approved_at', () => {
    const dto = serializeOrgFull(makeOrg() as never, false) as Record<string, unknown>;
    expect(dto).toHaveProperty('approved_at', now);
  });
});
