/**
 * CASL ability builder — pattern-based, scope-aware.
 *
 * Pattern format:  "{subject|*}:{action|*}:{scope}"
 *
 * Expansion rules (applied at JWT build time):
 *   *:*:platform  →  can('manage', 'all')                        1 rule
 *   *:*:org       →  can('manage', Subject, condition) per subject  N rules
 *   user:*:org    →  can('manage', 'User', condition)             1 rule
 *   user:read:org →  can('read',   'User', condition)             1 rule
 *
 * Using CASL's `manage` action for wildcard actions means the JWT carries
 * the minimum number of rules regardless of how many permissions exist.
 *
 * Scope → condition:
 *   own      →  { id: userId }  (or { id: orgId } for Org subject)
 *   org      →  { org_id: orgId } (or { id: orgId } for Org/Role subjects)
 *   platform →  no condition
 */
import { createMongoAbility } from '@casl/ability';
import type { MongoAbility, RawRuleOf } from '@casl/ability';
import { unpackRules } from '@casl/ability/extra';
import type { PackRule } from '@casl/ability/extra';
import type { PermissionAction, PermissionSubject } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionScope = 'own' | 'org' | 'platform';
export const SCOPE_RANK: Record<PermissionScope, number> = { own: 0, org: 1, platform: 2 };

export type Actions = PermissionAction | 'manage';
export type Subjects = PermissionSubject | 'all';
export type AppAbility = MongoAbility<[Actions, Subjects]>;
export type AppRule = RawRuleOf<AppAbility>;

// ---------------------------------------------------------------------------
// Subject code ↔ Prisma enum mapping
// ---------------------------------------------------------------------------

export const SUBJECT_CODE_TO_ENUM: Record<string, PermissionSubject> = {
  user:         'User',
  org:          'Org',
  role:         'Role',
  invitation:   'Invitation',
  org_document: 'OrgDocument',
  audit_log:    'AuditLog',
  notification: 'Notification',
};

export const ALL_SUBJECTS = Object.values(SUBJECT_CODE_TO_ENUM) as PermissionSubject[];

// ---------------------------------------------------------------------------
// Scope → CASL condition
// ---------------------------------------------------------------------------

const scopeToCondition = (
  scope: PermissionScope,
  subject: PermissionSubject,
  userId: string,
  orgId: string | null,
): Record<string, unknown> | undefined => {
  if (scope === 'platform') return undefined;

  if (scope === 'own') {
    if (subject === 'Org') return orgId ? { id: orgId } : undefined;
    return { id: userId };
  }

  // scope === 'org'
  if (subject === 'Org')  return orgId ? { id: orgId }     : undefined;
  if (subject === 'Role') return orgId ? { org_id: orgId } : undefined;
  return orgId ? { org_id: orgId } : undefined;
};

// ---------------------------------------------------------------------------
// Pattern → CASL rules
// ---------------------------------------------------------------------------

/**
 * Expand a single grant pattern into one or more CASL rules.
 *
 * "*:*:platform"  →  [{ action: 'manage', subject: 'all' }]
 * "*:*:org"       →  one { action: 'manage', subject: S, conditions? } per subject
 * "user:*:org"    →  [{ action: 'manage', subject: 'User', conditions? }]
 * "user:read:org" →  [{ action: 'read',   subject: 'User', conditions? }]
 */
const expandPattern = (
  pattern: string,
  userId: string,
  orgId: string | null,
): AppRule[] => {
  const parts = pattern.split(':');
  const scope    = parts[parts.length - 1] as PermissionScope;
  const action   = parts[parts.length - 2];                        // e.g. 'read' | '*'
  const subjCode = parts.slice(0, parts.length - 2).join('_');     // e.g. 'audit_log' | '*'

  const caslAction: Actions = action === '*' ? 'manage' : (action as PermissionAction);

  // *:*:platform → can('manage', 'all')
  if (subjCode === '*' && action === '*' && scope === 'platform') {
    return [{ action: 'manage', subject: 'all' }];
  }

  // subject is wildcard → emit one rule per known subject
  const subjects: PermissionSubject[] =
    subjCode === '*' ? ALL_SUBJECTS : [SUBJECT_CODE_TO_ENUM[subjCode]].filter(Boolean) as PermissionSubject[];

  return subjects.map((subject) => {
    const condition = scopeToCondition(scope, subject, userId, orgId);
    return condition
      ? { action: caslAction, subject, conditions: condition }
      : { action: caslAction, subject };
  });
};

/**
 * Build CASL rules from a list of grant patterns.
 * Deduplicates by (action, subject) keeping the broadest scope (platform > org > own).
 */
export const buildRulesFromGrants = (
  patterns: string[],
  userId: string,
  orgId: string | null,
): AppRule[] => {
  // Deduplicate: for the same (action, subject), keep the least-restrictive condition.
  // We track the best scope seen per (action, subject) key.
  const best = new Map<string, { scope: PermissionScope; rule: AppRule }>();

  for (const pattern of patterns) {
    const parts   = pattern.split(':');
    const scope   = parts[parts.length - 1] as PermissionScope;
    const rules   = expandPattern(pattern, userId, orgId);

    for (const rule of rules) {
      const key = `${rule.action}:${rule.subject}`;
      const existing = best.get(key);
      if (!existing || SCOPE_RANK[scope] > SCOPE_RANK[existing.scope]) {
        best.set(key, { scope, rule });
      }
    }
  }

  const result = Array.from(best.values()).map((e) => e.rule);

  // Org-scoped users who have explicit Role management access (i.e. their grants
  // include a specific role:*:org pattern, which produces a manage:Role rule with
  // org conditions) can also READ global role templates (org_id = null) so they
  // can browse the catalog when customising their org's roles.
  // They cannot write global templates — no manage rule will match { org_id: null }.
  // Platform admin already has unconditional access; skip for them.
  // We only inject this when the pattern set includes the role subject explicitly
  // (tracked via the dedup key "manage:Role" that comes from "role:*:org" or "*:*:org").
  const isPlatformAdmin = result.some((r) => r.subject === 'all' && !r.conditions);
  if (!isPlatformAdmin && orgId) {
    const hasOrgRoleManage = best.has('manage:Role');
    if (hasOrgRoleManage) {
      result.push({ action: 'read', subject: 'Role' as Subjects, conditions: { org_id: null } });
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Build an AppAbility from packed JWT rules (called by middleware). */
export const buildAbility = (packedRules: PackRule<AppRule>[]): AppAbility =>
  createMongoAbility<AppAbility>(unpackRules(packedRules));

/** Build an AppAbility from already-unpacked rules. */
export const buildAbilityFromRules = (rules: AppRule[]): AppAbility =>
  createMongoAbility<AppAbility>(rules);

// ---------------------------------------------------------------------------
// Scope inference
// ---------------------------------------------------------------------------

/**
 * Returns the effective scope a caller has for a given action + subject.
 *
 * Rules are examined in descending priority:
 *   platform — rule with no conditions
 *   org      — rule whose condition key is `org_id` or `id` on an org-like subject
 *   own      — rule whose condition key is `id` (self-reference)
 *   null     — no matching rule (should not happen after authorize middleware)
 */
export const getScopeFor = (
  ability: AppAbility,
  action: Actions,
  subject: Subjects,
): PermissionScope | null => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules = ability.rulesFor(action, subject as any);
  if (rules.some((r) => !r.conditions)) return 'platform';
  if (rules.some((r) => r.conditions && 'org_id' in (r.conditions as object))) return 'org';
  if (rules.some((r) => r.conditions && 'id' in (r.conditions as object))) return 'own';
  return null;
};

// ---------------------------------------------------------------------------
// Pattern compression
// ---------------------------------------------------------------------------

const ENUM_TO_SUBJECT_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(SUBJECT_CODE_TO_ENUM).map(([code, e]) => [e as string, code]),
);

/**
 * Given a set of grant patterns, return the minimal equivalent set by
 * folding individual action patterns into wildcards where all valid actions
 * for a (subject, scope) pair are present.
 *
 * Compression hierarchy (highest wins):
 *   subject:action:scope  →  subject:*:scope  (all actions covered)
 *   subject:*:scope × N   →  *:*:scope        (all subjects covered)
 *   *:*:platform          →  subsumes everything
 *
 * Also removes patterns already subsumed by an existing wildcard in the
 * input (e.g. user:read:org when user:*:org is also present).
 */
export const compressPatterns = (
  patterns: string[],
  catalog: Array<{ action: PermissionAction; subject: PermissionSubject; scopes: PermissionScope[] }>,
): string[] => {
  if (patterns.includes('*:*:platform')) return ['*:*:platform'];

  const working = new Set(patterns);

  // Build subjectCode → scope → Set<valid action> from catalog
  const validAt = new Map<string, Map<PermissionScope, Set<PermissionAction>>>();
  for (const p of catalog) {
    const code = ENUM_TO_SUBJECT_CODE[p.subject as string];
    if (!code) continue;
    if (!validAt.has(code)) validAt.set(code, new Map());
    for (const scope of p.scopes) {
      if (!validAt.get(code)!.has(scope)) validAt.get(code)!.set(scope, new Set());
      validAt.get(code)!.get(scope)!.add(p.action);
    }
  }

  // Phase 1: drop patterns already covered by a wildcard in the input
  for (const p of Array.from(working)) {
    const [subjCode, action, scope] = p.split(':') as [string, string, PermissionScope];
    if (subjCode === '*' && action === '*') continue;
    if (working.has(`*:*:${scope}`)) { working.delete(p); continue; }
    if (action !== '*' && working.has(`${subjCode}:*:${scope}`)) { working.delete(p); continue; }
  }

  // Phase 2: subject:action:scope → subject:*:scope when all actions are present
  for (const [code, scopeMap] of validAt) {
    for (const [scope, actions] of scopeMap) {
      if (working.has(`*:*:${scope}`) || working.has(`${code}:*:${scope}`)) continue;
      if (actions.size === 0) continue;
      if (Array.from(actions).every(a => working.has(`${code}:${a}:${scope}`))) {
        for (const a of actions) working.delete(`${code}:${a}:${scope}`);
        working.add(`${code}:*:${scope}`);
      }
    }
  }

  // Phase 3: subject:*:scope × all-subjects → *:*:scope
  for (const scope of ['own', 'org', 'platform'] as PermissionScope[]) {
    if (working.has(`*:*:${scope}`)) continue;
    const subjectsAtScope = Array.from(validAt.entries())
      .filter(([, sm]) => sm.has(scope))
      .map(([code]) => code);
    if (subjectsAtScope.length > 0 && subjectsAtScope.every(code => working.has(`${code}:*:${scope}`))) {
      for (const code of subjectsAtScope) working.delete(`${code}:*:${scope}`);
      working.add(`*:*:${scope}`);
    }
  }

  if (working.has('*:*:platform')) return ['*:*:platform'];
  return Array.from(working);
};

// ---------------------------------------------------------------------------
// Pattern validation (used by role/grant service endpoints)
// ---------------------------------------------------------------------------

/**
 * Returns true if the pattern is syntactically valid and matches at least one
 * entry in the permission catalog for the given scope.
 *
 * Pass the PERMISSIONS array from bootstrap.ts as the catalog.
 */
export const isValidPattern = (
  pattern: string,
  catalog: Array<{ action: PermissionAction; subject: PermissionSubject; scopes: PermissionScope[] }>,
): boolean => {
  const parts = pattern.split(':');
  if (parts.length !== 3) return false;

  const [subjCode, action, scope] = parts;
  if (!['own', 'org', 'platform'].includes(scope)) return false;

  return catalog.some((p) => {
    const pCode = `${p.subject.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}`;
    const matchesSubject = subjCode === '*' || pCode === subjCode;
    const matchesAction  = action   === '*' || p.action === action;
    const scopeValid     = p.scopes.includes(scope as PermissionScope);
    return matchesSubject && matchesAction && scopeValid;
  });
};

/**
 * Returns the highest scope present in a list of patterns.
 * Used for privilege escalation checks.
 */
export const maxScopeFromPatterns = (patterns: string[]): PermissionScope => {
  let max: PermissionScope = 'own';
  for (const p of patterns) {
    const scope = p.split(':')[p.split(':').length - 1] as PermissionScope;
    if (SCOPE_RANK[scope] > SCOPE_RANK[max]) max = scope;
  }
  return max;
};
