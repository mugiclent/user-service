import type { Org, OrgStatus, OrgType } from '@prisma/client';
import type { UserWithRoles } from './index.js';
import type { AppRule } from '../utils/ability.js';
import { displayPhone } from '../utils/phone.js';

// ---------------------------------------------------------------------------
// Auth response user (login, verify-phone responses)
// ---------------------------------------------------------------------------

export interface AuthUserDto {
  id: string;
  first_name: string;
  last_name: string;
  user_type: 'passenger' | 'staff';
  avatar_path: string | null;
  org_id: string | null;
  roles: string[];
  status: 'active' | 'pending_verification' | 'suspended' | 'pending_deletion' | 'deleted';
  two_factor_enabled: boolean;
  login_channel: string | null;
  locale: string;
}

export const serializeUserForAuth = (user: UserWithRoles): AuthUserDto => ({
  id: user.id,
  first_name: user.first_name,
  last_name: user.last_name,
  user_type: user.user_type,
  avatar_path: user.avatar_path,
  org_id: user.org_id,
  roles: user.user_roles.map((ur) => ur.role.slug),
  status: user.status,
  two_factor_enabled: user.two_factor_enabled,
  login_channel: user.login_channel,
  locale: user.locale,
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
  avatar_path: string | null;
  user_type: 'passenger';
  status: string;
  login_channel: string | null;
  notif_channel: string[];
  locale: string;
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
  phone_verified_at: Date | null;
  email: string | null;
  email_verified_at: Date | null;
  avatar_path: string | null;
  user_type: 'staff';
  status: string;
  org_id: string | null;
  roles: string[];
  permissions: AppRule[];
  login_channel: string | null;
  notif_channel: string[];
  locale: string;
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
      phone_number: user.phone_number ? displayPhone(user.phone_number) : null,
      phone_verified_at: user.phone_verified_at,
      email: user.email,
      email_verified_at: user.email_verified_at,
      avatar_path: user.avatar_path,
      user_type: 'passenger',
      status: user.status,
      login_channel: user.login_channel,
      notif_channel: user.notif_channel,
      locale: user.locale,
      two_factor_enabled: user.two_factor_enabled,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }

  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    phone_number: user.phone_number ? displayPhone(user.phone_number) : null,
    phone_verified_at: user.phone_verified_at,
    email: user.email,
    email_verified_at: user.email_verified_at,
    avatar_path: user.avatar_path,
    user_type: 'staff',
    status: user.status,
    org_id: user.org_id,
    roles: user.user_roles.map((ur) => ur.role.slug),
    permissions: rules,
    login_channel: user.login_channel,
    notif_channel: user.notif_channel,
    locale: user.locale,
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

/** Mask stored phone to +250788***001 format */
export const maskPhone = (phone: string): string => {
  if (phone.length <= 6) return displayPhone(phone);
  return `+${phone.slice(0, 3)}${phone.slice(3, 6)}***${phone.slice(-3)}`;
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
      ? displayPhone(user.phone_number)
      : maskPhone(user.phone_number)
    : null,
  avatar_path: user.avatar_path,
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
  phone_number: user.phone_number ? displayPhone(user.phone_number) : null,
  phone_verified_at: user.phone_verified_at,
  email: user.email,
  email_verified_at: user.email_verified_at,
  avatar_path: user.avatar_path,
  user_type: user.user_type,
  status: user.status,
  org_id: user.org_id,
  roles: user.user_roles.map((ur) => ur.role.slug),
  login_channel: user.login_channel,
  notif_channel: user.notif_channel,
  locale: user.locale,
  two_factor_enabled: user.two_factor_enabled,
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
  logo_path: string | null;
  contact_first_name: string;
  contact_last_name: string;
  contact_email: string;
  contact_phone: string;
  parent_org_id: string | null;
  cooperative_approved_at: Date | null;
  approved_at: Date | null;
  created_at: Date;
}

export const serializeOrgForList = (org: Org): OrgListItemDto => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  org_type: org.org_type,
  status: org.status,
  logo_path: org.logo_path,
  contact_first_name: org.contact_first_name,
  contact_last_name: org.contact_last_name,
  contact_email: org.contact_email,
  contact_phone: org.contact_phone,
  parent_org_id: org.parent_org_id,
  cooperative_approved_at: org.cooperative_approved_at,
  approved_at: org.approved_at,
  created_at: org.created_at,
});

export const serializeOrgCreated = (org: Org): Record<string, unknown> => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  org_type: org.org_type,
  status: org.status,
  contact_first_name: org.contact_first_name,
  contact_last_name: org.contact_last_name,
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
  logo_path: org.logo_path,
  contact_first_name: org.contact_first_name,
  contact_last_name: org.contact_last_name,
  contact_email: org.contact_email,
  contact_phone: org.contact_phone,
  address: org.address,
  tin: org.tin,
  license_number: org.license_number,
  parent_org_id: org.parent_org_id,
  parent_org: org.parent_org,
  cooperative_approved_at: org.cooperative_approved_at,
  ...(isAdmin ? { child_orgs: org.child_orgs, approved_by: org.approved_by, cooperative_approved_by: org.cooperative_approved_by } : {}),
  approved_at: org.approved_at,
  created_at: org.created_at,
  updated_at: org.updated_at,
});
