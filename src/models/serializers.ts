import type { User, Org, OrgStatus, OrgType } from '@prisma/client';
import type { UserWithRoles } from './index.js';
import type { AppRule } from '../utils/ability.js';

// ---------------------------------------------------------------------------
// Auth response user (login, verify-phone responses)
// ---------------------------------------------------------------------------

export interface AuthUserDto {
  id: string;
  first_name: string;
  last_name: string;
  user_type: 'passenger' | 'staff';
  avatar_url: string | null;
  org_id: string | null;
  roles: string[];
  status: 'active' | 'pending_verification' | 'suspended';
  two_factor_enabled: boolean;
}

export const serializeUserForAuth = (user: UserWithRoles): AuthUserDto => ({
  id: user.id,
  first_name: user.first_name,
  last_name: user.last_name,
  user_type: user.user_type,
  avatar_url: user.avatar_url,
  org_id: user.org_id,
  roles: user.user_roles.map((ur) => ur.role.slug),
  status: user.status,
  two_factor_enabled: user.two_factor_enabled,
});

// ---------------------------------------------------------------------------
// GET /users/me — passenger view
// ---------------------------------------------------------------------------

export interface UserMePassengerDto {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  phone_verified_at: Date | null;
  email: string | null;
  email_verified_at: Date | null;
  avatar_url: string | null;
  user_type: 'passenger';
  status: string;
  two_factor_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// GET /users/me — staff view (includes permissions for frontend rendering)
// ---------------------------------------------------------------------------

export interface UserMeStaffDto {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  email: string | null;
  avatar_url: string | null;
  user_type: 'staff';
  status: string;
  org_id: string | null;
  roles: string[];
  permissions: AppRule[];
  two_factor_enabled: boolean;
  driver_license_number: string | null;
  driver_license_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const serializeUserMe = (
  user: UserWithRoles,
  rules: AppRule[],
): UserMePassengerDto | UserMeStaffDto => {
  if (user.user_type === 'passenger') {
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      phone_number: user.phone_number,
      phone_verified_at: user.phone_verified_at,
      email: user.email,
      email_verified_at: user.email_verified_at,
      avatar_url: user.avatar_url,
      user_type: 'passenger',
      status: user.status,
      two_factor_enabled: user.two_factor_enabled,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }

  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    phone_number: user.phone_number,
    email: user.email,
    avatar_url: user.avatar_url,
    user_type: 'staff',
    status: user.status,
    org_id: user.org_id,
    roles: user.user_roles.map((ur) => ur.role.slug),
    permissions: rules,
    two_factor_enabled: user.two_factor_enabled,
    driver_license_number: user.driver_license_number,
    driver_license_verified_at: user.driver_license_verified_at,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
};

// ---------------------------------------------------------------------------
// GET /users list item
// ---------------------------------------------------------------------------

/** Mask phone to +250788***123 format */
export const maskPhone = (phone: string): string => {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
};

export const serializeUserForList = (
  user: UserWithRoles,
  isAdmin: boolean,
): Record<string, unknown> => ({
  id: user.id,
  first_name: user.first_name,
  last_name: user.last_name,
  email: user.email,
  phone_number: user.phone_number
    ? isAdmin
      ? user.phone_number
      : maskPhone(user.phone_number)
    : null,
  avatar_url: user.avatar_url,
  user_type: user.user_type,
  status: user.status,
  roles: user.user_roles.map((ur) => ur.role.slug),
  org_id: user.org_id,
  ...(isAdmin ? { last_login_at: user.last_login_at } : {}),
  created_at: user.created_at,
});

// ---------------------------------------------------------------------------
// GET /users/:id — full profile
// ---------------------------------------------------------------------------

export const serializeUserFullProfile = (
  user: UserWithRoles,
  isAdmin: boolean,
): Record<string, unknown> => ({
  id: user.id,
  first_name: user.first_name,
  last_name: user.last_name,
  email: user.email,
  phone_number: user.phone_number,
  phone_verified_at: user.phone_verified_at,
  email_verified_at: user.email_verified_at,
  avatar_url: user.avatar_url,
  user_type: user.user_type,
  status: user.status,
  org_id: user.org_id,
  roles: user.user_roles.map((ur) => ur.role.slug),
  ...(isAdmin
    ? {
        driver_license_number: user.driver_license_number,
        driver_license_verified_at: user.driver_license_verified_at,
        last_login_at: user.last_login_at,
      }
    : {}),
  created_at: user.created_at,
  updated_at: user.updated_at,
});

// ---------------------------------------------------------------------------
// Org serializers
// ---------------------------------------------------------------------------

export interface OrgListItemDto {
  id: string;
  name: string;
  slug: string;
  org_type: OrgType;
  status: OrgStatus;
  logo_url: string | null;
  contact_email: string;
  contact_phone: string;
  parent_org_id: string | null;
  approved_at: Date | null;
  created_at: Date;
}

export const serializeOrgForList = (org: Org): OrgListItemDto => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  org_type: org.org_type,
  status: org.status,
  logo_url: org.logo_url,
  contact_email: org.contact_email,
  contact_phone: org.contact_phone,
  parent_org_id: org.parent_org_id,
  approved_at: org.approved_at,
  created_at: org.created_at,
});

export const serializeOrgCreated = (org: Org): Record<string, unknown> => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  org_type: org.org_type,
  status: org.status,
  contact_email: org.contact_email,
  contact_phone: org.contact_phone,
  parent_org_id: org.parent_org_id,
  created_at: org.created_at,
});

type OrgWithRelations = Org & {
  parent_org: { id: string; name: string; slug: string; status: OrgStatus } | null;
  child_orgs: { id: string; name: string; slug: string; status: OrgStatus }[];
};

export const serializeOrgFull = (
  org: OrgWithRelations,
  isAdmin: boolean,
): Record<string, unknown> => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  org_type: org.org_type,
  status: org.status,
  logo_url: org.logo_url,
  contact_email: org.contact_email,
  contact_phone: org.contact_phone,
  address: org.address,
  tin: org.tin,
  license_number: org.license_number,
  parent_org_id: org.parent_org_id,
  parent_org: org.parent_org,
  ...(isAdmin ? { child_orgs: org.child_orgs, approved_by: org.approved_by } : {}),
  approved_at: org.approved_at,
  created_at: org.created_at,
  updated_at: org.updated_at,
});
