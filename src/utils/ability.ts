import { createMongoAbility } from '@casl/ability';
import type { MongoAbility, RawRuleOf } from '@casl/ability';
import { unpackRules } from '@casl/ability/extra';
import type { PackRule } from '@casl/ability/extra';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Actions = 'create' | 'read' | 'update' | 'delete' | 'manage';
export type Subjects = 'User' | 'Org' | 'Role' | 'all';
export type AppAbility = MongoAbility<[Actions, Subjects]>;
export type AppRule = RawRuleOf<AppAbility>;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Build an AppAbility from packed JWT rules. */
export const buildAbility = (packedRules: PackRule<AppRule>[]): AppAbility =>
  createMongoAbility<AppAbility>(unpackRules(packedRules));

/** Build an AppAbility from already-unpacked rules (e.g. after passport strategy unpacks them). */
export const buildAbilityFromRules = (rules: AppRule[]): AppAbility =>
  createMongoAbility<AppAbility>(rules);

/**
 * Build raw CASL rules from a user's identity and role slugs.
 * Called by TokenService when issuing access tokens — the result is packed into the JWT.
 *
 * Role hierarchy:
 *   katisha_super_admin / katisha_admin → manage all
 *   katisha_support                    → read-only platform-wide
 *   org_admin                          → manage Users in their org + read/update their Org
 *   driver / dispatcher / passenger    → read + update own User only
 */
export const buildRulesForUser = (
  userId: string,
  orgId: string | null,
  roleSlugs: string[],
): AppRule[] => {
  if (roleSlugs.includes('katisha_super_admin') || roleSlugs.includes('katisha_admin')) {
    return [{ action: 'manage', subject: 'all' }] as AppRule[];
  }

  if (roleSlugs.includes('katisha_support')) {
    return [
      { action: 'read', subject: 'User' },
      { action: 'read', subject: 'Org' },
    ] as AppRule[];
  }

  const rules: AppRule[] = [];

  if (roleSlugs.includes('org_admin') && orgId) {
    rules.push({ action: 'manage', subject: 'User', conditions: { org_id: orgId } } as AppRule);
    rules.push({ action: 'read',   subject: 'Org',  conditions: { id: orgId }     } as AppRule);
    rules.push({ action: 'update', subject: 'Org',  conditions: { id: orgId }     } as AppRule);
  }

  // Everyone can read and update their own profile
  rules.push({ action: 'read',   subject: 'User', conditions: { id: userId } } as AppRule);
  rules.push({ action: 'update', subject: 'User', conditions: { id: userId } } as AppRule);

  return rules;
};
