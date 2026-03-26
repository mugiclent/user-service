import { createMongoAbility } from '@casl/ability';
import type { MongoAbility, RawRuleOf } from '@casl/ability';
import { unpackRules } from '@casl/ability/extra';
import type { PackRule } from '@casl/ability/extra';
import type { UserWithRoles } from '../models/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionLevel = 'manage' | 'write' | 'read';
export type Actions = 'create' | 'read' | 'update' | 'delete' | 'manage';
export type Subjects = 'User' | 'Org' | 'Role' | 'all';
export type AppAbility = MongoAbility<[Actions, Subjects]>;
export type AppRule = RawRuleOf<AppAbility>;

/** A DB permission entry with the role slugs that contribute it. */
export interface PermissionEntry {
  level: PermissionLevel;
  subject: string;
  roleSlugs: string[];
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Build an AppAbility from packed JWT rules. */
export const buildAbility = (packedRules: PackRule<AppRule>[]): AppAbility =>
  createMongoAbility<AppAbility>(unpackRules(packedRules));

/** Build an AppAbility from already-unpacked rules (e.g. after passport strategy unpacks them). */
export const buildAbilityFromRules = (rules: AppRule[]): AppAbility =>
  createMongoAbility<AppAbility>(rules);

// ---------------------------------------------------------------------------
// Permission level → CASL actions expansion
// ---------------------------------------------------------------------------

// 'manage' is a CASL special keyword — covers create/read/update/delete implicitly.
// 'write' is not a CASL built-in; manually expand to create+read+update.
const LEVEL_TO_ACTIONS: Record<PermissionLevel, Actions[]> = {
  manage: ['manage'],
  write:  ['create', 'read', 'update'],
  read:   ['read'],
};

// Self-only roles are scoped to { id: userId } — omit 'create' from write expansion
// because a user scoped to their own record cannot create other users.
const SELF_ONLY_ROLES = new Set(['driver', 'passenger']);

// ---------------------------------------------------------------------------
// Condition applicators (subject-aware, runtime context-driven)
// ---------------------------------------------------------------------------

type ConditionFn = (userId: string, orgId: string | null) => Record<string, unknown> | undefined;

// Conditions are applied based on role slug + subject.
// No entry → unconditioned (platform-wide access).
// Note: Org conditions use { id: orgId } — the Org.id primary key, not a foreign key.
const ROLE_CONDITIONS: Record<string, Record<string, ConditionFn>> = {
  org_admin: {
    User: (_, orgId) => orgId ? { org_id: orgId } : undefined,
    Org:  (_, orgId) => orgId ? { id: orgId }     : undefined,
    Role: (_, orgId) => orgId ? { org_id: orgId } : undefined,
  },
  dispatcher: {
    User: (_, orgId) => orgId ? { org_id: orgId } : undefined,
    Org:  (_, orgId) => orgId ? { id: orgId }     : undefined,
  },
  driver:    { User: (userId) => ({ id: userId }) },
  passenger: { User: (userId) => ({ id: userId }) },
};

// ---------------------------------------------------------------------------
// collectPermissions — aggregate DB permissions from a loaded user
// ---------------------------------------------------------------------------

/**
 * Collect permission entries from a user's role_permissions and user_permissions.
 * Merges entries for the same (level, subject) pair, tracking all contributing role slugs.
 * Direct user grants use '__direct__' sentinel slug → treated as unconditioned.
 */
export const collectPermissions = (user: UserWithRoles): PermissionEntry[] => {
  const map = new Map<string, PermissionEntry>();

  for (const ur of user.user_roles) {
    const slug = ur.role.slug;
    for (const rp of ur.role.role_permissions) {
      const key = `${rp.permission.level}:${rp.permission.subject}`;
      const existing = map.get(key);
      if (existing) {
        existing.roleSlugs.push(slug);
      } else {
        map.set(key, {
          level: rp.permission.level as PermissionLevel,
          subject: rp.permission.subject,
          roleSlugs: [slug],
        });
      }
    }
  }

  // Direct user permission grants — unconditioned (override semantics)
  for (const up of user.user_permissions) {
    const key = `${up.permission.level}:${up.permission.subject}`;
    const existing = map.get(key);
    if (existing) {
      existing.roleSlugs.push('__direct__');
    } else {
      map.set(key, {
        level: up.permission.level as PermissionLevel,
        subject: up.permission.subject,
        roleSlugs: ['__direct__'],
      });
    }
  }

  return Array.from(map.values());
};

// ---------------------------------------------------------------------------
// buildRulesForUser — DB-driven, permission-level expansion with conditions
// ---------------------------------------------------------------------------

/**
 * Build raw CASL rules from collected permission entries.
 * Called by TokenService when issuing access tokens — result is packed into JWT.
 *
 * Permission levels:
 *   manage → CASL 'manage' (covers everything)
 *   write  → create + read + update (no delete)
 *   read   → read only
 *
 * Conditions are applied based on role slug + subject:
 *   org_admin → User: { org_id }, Org: { id: orgId }
 *   dispatcher → same as org_admin
 *   driver / passenger → User: { id: userId } (self only, no create)
 *   platform roles (katisha_*) and '__direct__' → unconditioned
 */
export const buildRulesForUser = (
  userId: string,
  orgId: string | null,
  entries: PermissionEntry[],
): AppRule[] => {
  const rules: AppRule[] = [];

  for (const entry of entries) {
    // Self-only roles: omit 'create' from write expansion
    const isSelfOnly = entry.roleSlugs.every((s) => SELF_ONLY_ROLES.has(s));
    let actions = LEVEL_TO_ACTIONS[entry.level];
    if (isSelfOnly) actions = actions.filter((a) => a !== 'create');

    // If ANY contributing role slug has no condition → rule is unrestricted (platform-wide).
    // '__direct__' has no ROLE_CONDITIONS entry → always unrestricted.
    let condition: Record<string, unknown> | undefined;
    let hasUnrestricted = false;

    for (const slug of entry.roleSlugs) {
      const fn = ROLE_CONDITIONS[slug]?.[entry.subject];
      if (!fn) { hasUnrestricted = true; break; }
      const c = fn(userId, orgId);
      if (!c) { hasUnrestricted = true; break; }
      condition = { ...condition, ...c };
    }

    const finalCondition = hasUnrestricted ? undefined : condition;

    for (const action of actions) {
      rules.push(
        finalCondition
          ? { action, subject: entry.subject as Subjects, conditions: finalCondition }
          : { action, subject: entry.subject as Subjects },
      );
    }
  }

  return rules;
};
