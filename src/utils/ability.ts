/**
 * CASL ability builder — pattern-based, scope-aware, catalog-driven.
 *
 * Grant pattern:  "{subject|*}:{action|*}:{scope}"   scope ∈ own | org | platform
 *
 * There is exactly ONE source of truth for which (subject, action) pairs exist
 * and at which scopes: the PERMISSIONS catalog (utils/catalog.ts). Both pattern
 * expansion (→ JWT rules) and pattern compression (→ DB rows) are driven by it,
 * which makes them provable inverses:  expand(compress(P)) === expand(P).
 *
 * Two layers of compaction, both lossless:
 *   1. DB rows   — patterns folded into wildcards (compressPatterns)
 *   2. JWT rules — CASL `manage` emitted for a subject ONLY when the principal
 *                  holds every catalog action for it, so it can never over-grant.
 *
 * `manage` is reserved for the CASL wildcard. It is never a literal permission
 * action (see catalog.ts) — so a `manage` rule unambiguously means "all actions".
 *
 * Self-contained conditions: rules carry the owner's identity baked in at mint
 * time, so downstream services never look up the caller's org/user id:
 *   own      → User:{ id:userId }  Org:{ id:orgId }  else { user_id:userId }
 *   org      → Org:{ id:orgId }    Role/else:{ org_id:orgId }
 *   platform → no condition
 * Platform convention: ownable resources expose `user_id`; org-scoped resources
 * expose `org_id`. Use accessibleBy(ability) / can(action, subject(S, record)).
 */
import { createMongoAbility } from '@casl/ability';
import type { MongoAbility, RawRuleOf } from '@casl/ability';
import { unpackRules } from '@casl/ability/extra';
import type { PackRule } from '@casl/ability/extra';
import { accessibleBy } from '@casl/prisma';
import { PermissionSubject } from '@prisma/client';
import type { PermissionAction } from '@prisma/client';
import type { PermissionScope, PermissionSeed } from './catalog.js';
import { AppError } from './AppError.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { PermissionScope } from './catalog.js';
export const SCOPE_RANK: Record<PermissionScope, number> = { own: 0, org: 1, platform: 2 };
const SCOPES: PermissionScope[] = ['own', 'org', 'platform'];

export type Actions = PermissionAction | 'manage';
export type Subjects = PermissionSubject | 'all';
export type AppAbility = MongoAbility<[Actions, Subjects]>;
export type AppRule = RawRuleOf<AppAbility>;

// ---------------------------------------------------------------------------
// Subject code ↔ Prisma enum — auto-derived from the enum so it can never drift
// ---------------------------------------------------------------------------

/** "OrgDocument" → "org_document", "AuditLog" → "audit_log", "User" → "user". */
export const toSubjectCode = (subject: string): string =>
  subject.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

export const ALL_SUBJECTS = Object.values(PermissionSubject) as PermissionSubject[];

export const SUBJECT_CODE_TO_ENUM: Record<string, PermissionSubject> = Object.fromEntries(
  ALL_SUBJECTS.map((s) => [toSubjectCode(s), s]),
) as Record<string, PermissionSubject>;

const ENUM_TO_SUBJECT_CODE: Record<string, string> = Object.fromEntries(
  ALL_SUBJECTS.map((s) => [s as string, toSubjectCode(s)]),
);

// ---------------------------------------------------------------------------
// Catalog index — memoised per catalog reference
// ---------------------------------------------------------------------------

interface CatalogIndex {
  /** subject → scope → set of valid actions */
  actionsBySubjectScope: Map<PermissionSubject, Map<PermissionScope, Set<PermissionAction>>>;
  /** subject → every action defined for it across all scopes */
  allActionsBySubject: Map<PermissionSubject, Set<PermissionAction>>;
  /** scope → subjects that have at least one permission at that scope */
  subjectsByScope: Map<PermissionScope, Set<PermissionSubject>>;
}

const indexCache = new WeakMap<PermissionSeed[], CatalogIndex>();

const buildCatalogIndex = (catalog: PermissionSeed[]): CatalogIndex => {
  const cached = indexCache.get(catalog);
  if (cached) return cached;

  const actionsBySubjectScope = new Map<PermissionSubject, Map<PermissionScope, Set<PermissionAction>>>();
  const allActionsBySubject = new Map<PermissionSubject, Set<PermissionAction>>();
  const subjectsByScope = new Map<PermissionScope, Set<PermissionSubject>>();

  for (const p of catalog) {
    if (!allActionsBySubject.has(p.subject)) allActionsBySubject.set(p.subject, new Set());
    allActionsBySubject.get(p.subject)!.add(p.action);

    if (!actionsBySubjectScope.has(p.subject)) actionsBySubjectScope.set(p.subject, new Map());
    const scopeMap = actionsBySubjectScope.get(p.subject)!;
    for (const scope of p.scopes) {
      if (!scopeMap.has(scope)) scopeMap.set(scope, new Set());
      scopeMap.get(scope)!.add(p.action);
      if (!subjectsByScope.has(scope)) subjectsByScope.set(scope, new Set());
      subjectsByScope.get(scope)!.add(p.subject);
    }
  }

  const index = { actionsBySubjectScope, allActionsBySubject, subjectsByScope };
  indexCache.set(catalog, index);
  return index;
};

/** Asserts every Prisma subject has at least one catalog entry. Call at startup. */
export const assertCatalogCoversAllSubjects = (catalog: PermissionSeed[]): void => {
  const idx = buildCatalogIndex(catalog);
  const missing = ALL_SUBJECTS.filter((s) => !idx.allActionsBySubject.has(s));
  if (missing.length > 0) {
    throw new Error(`[ability] permission catalog is missing subjects: ${missing.join(', ')}`);
  }
};

// ---------------------------------------------------------------------------
// Pattern parsing
// ---------------------------------------------------------------------------

interface ParsedPattern { subjCode: string; action: string; scope: PermissionScope; }

const parsePattern = (pattern: string): ParsedPattern | null => {
  const parts = pattern.split(':');
  if (parts.length !== 3) return null;
  const [subjCode, action, scope] = parts;
  if (!SCOPES.includes(scope as PermissionScope)) return null;
  return { subjCode, action, scope: scope as PermissionScope };
};

// ---------------------------------------------------------------------------
// Scope → CASL condition (self-contained — baked at mint time)
// ---------------------------------------------------------------------------

const scopeToCondition = (
  scope: PermissionScope,
  subject: PermissionSubject,
  userId: string,
  orgId: string | null,
): Record<string, unknown> | undefined => {
  if (scope === 'platform') return undefined;

  if (scope === 'own') {
    if (subject === 'User') return { id: userId };
    if (subject === 'Org') return orgId ? { id: orgId } : undefined;
    return { user_id: userId };
  }

  // scope === 'org'
  if (subject === 'Org') return orgId ? { id: orgId } : undefined;
  return orgId ? { org_id: orgId } : undefined;
};

// ---------------------------------------------------------------------------
// Decompression: patterns → effective (subject, action) → broadest scope
// ---------------------------------------------------------------------------

export interface EffectiveGrant {
  subject: PermissionSubject;
  action: PermissionAction;
  scope: PermissionScope;
}

/**
 * Expand grant patterns into the exact set of catalog-valid (subject, action)
 * pairs, keeping the broadest scope seen for each. This is the canonical
 * "decompression" used by both rule building and the assignment guard.
 *
 * Patterns/components not present in the catalog are silently dropped — an
 * invalid grant can never widen a principal's effective permissions.
 */
export const expandToEffective = (
  patterns: string[],
  catalog: PermissionSeed[],
): Map<string, EffectiveGrant> => {
  const idx = buildCatalogIndex(catalog);
  const best = new Map<string, EffectiveGrant>();

  for (const pattern of patterns) {
    const parsed = parsePattern(pattern);
    if (!parsed) continue;
    const { subjCode, action, scope } = parsed;

    const subjects = subjCode === '*'
      ? (idx.subjectsByScope.get(scope) ? [...idx.subjectsByScope.get(scope)!] : [])
      : (SUBJECT_CODE_TO_ENUM[subjCode] ? [SUBJECT_CODE_TO_ENUM[subjCode]] : []);

    for (const subject of subjects) {
      const validActions = idx.actionsBySubjectScope.get(subject)?.get(scope);
      if (!validActions) continue;
      const actions = action === '*' ? [...validActions] : (validActions.has(action as PermissionAction) ? [action as PermissionAction] : []);
      for (const a of actions) {
        const key = `${subject}:${a}`;
        const cur = best.get(key);
        if (!cur || SCOPE_RANK[scope] > SCOPE_RANK[cur.scope]) {
          best.set(key, { subject, action: a, scope });
        }
      }
    }
  }

  return best;
};

// ---------------------------------------------------------------------------
// Rule building (patterns → packed-ready CASL rules)
// ---------------------------------------------------------------------------

/**
 * Build CASL rules for a principal's JWT.
 *
 * `*:*:platform` is the dedicated god-mode pattern → a single `manage all` rule
 * (it deliberately ignores the catalog so platform admins reach own-only
 * subjects like Wallet too).
 *
 * Otherwise: per subject, emit one `manage` rule when the principal holds EVERY
 * catalog action for that subject at a single scope (compact + can't over-grant),
 * else one rule per (action, scope).
 */
export const buildRulesFromGrants = (
  patterns: string[],
  userId: string,
  orgId: string | null,
  catalog: PermissionSeed[],
): AppRule[] => {
  if (patterns.includes('*:*:platform')) return [{ action: 'manage', subject: 'all' }];

  const idx = buildCatalogIndex(catalog);
  const effective = expandToEffective(patterns, catalog);

  // subject → action → scope
  const bySubject = new Map<PermissionSubject, Map<PermissionAction, PermissionScope>>();
  for (const g of effective.values()) {
    if (!bySubject.has(g.subject)) bySubject.set(g.subject, new Map());
    bySubject.get(g.subject)!.set(g.action, g.scope);
  }

  const rules: AppRule[] = [];

  for (const [subject, actionScopes] of bySubject) {
    const allActions = idx.allActionsBySubject.get(subject)!;
    const scopes = new Set(actionScopes.values());
    const holdsEveryAction = actionScopes.size === allActions.size;

    if (holdsEveryAction && scopes.size === 1) {
      const scope = [...scopes][0];
      const condition = scopeToCondition(scope, subject, userId, orgId);
      rules.push(condition ? { action: 'manage', subject, conditions: condition } : { action: 'manage', subject });
    } else {
      for (const [action, scope] of actionScopes) {
        const condition = scopeToCondition(scope, subject, userId, orgId);
        rules.push(condition ? { action, subject, conditions: condition } : { action, subject });
      }
    }
  }

  return rules;
};

// ---------------------------------------------------------------------------
// Ability builders
// ---------------------------------------------------------------------------

/** Build an AppAbility from packed JWT rules (called by middleware). */
export const buildAbility = (packedRules: PackRule<AppRule>[]): AppAbility =>
  createMongoAbility<AppAbility>(unpackRules(packedRules));

/** Build an AppAbility from already-unpacked rules. */
export const buildAbilityFromRules = (rules: AppRule[]): AppAbility =>
  createMongoAbility<AppAbility>(rules);

/**
 * Prisma `where` filter encoding the caller's read/own/org/platform boundary for
 * a subject, derived straight from their baked rule conditions. Use on list
 * endpoints so scoping is identical everywhere and never hand-written:
 *   prisma.user.findMany({ where: { AND: [ accessibleWhere(ability,'read','User'), ...filters ] } })
 *
 * platform (unconditional) → {} (all rows); org → { OR:[{org_id}] }.
 * If NO rule permits the action, @casl throws — we surface that as a real 403
 * rather than masking it as an empty result (route gates normally catch this first).
 */
export const accessibleWhere = (
  ability: AppAbility,
  action: Actions,
  subjectName: PermissionSubject,
): Record<string, unknown> => {
  // @casl/prisma types expect a PrismaAbility; our MongoAbility is runtime-compatible
  // (identical rule shape). The cast keeps the call site clean and type-safe downstream.
  const records = accessibleBy(ability as Parameters<typeof accessibleBy>[0], action) as Record<string, Record<string, unknown>>;
  try {
    return records[subjectName];
  } catch {
    // No rule permits this action on this subject — forbidden, not "empty".
    throw new AppError('FORBIDDEN', 403);
  }
};

// ---------------------------------------------------------------------------
// Scope inference
// ---------------------------------------------------------------------------

/**
 * The effective scope a principal has for an (action, subject) pair, or null if
 * they have no matching rule. `manage` rules count for every action.
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
  if (rules.some((r) => r.conditions && (('id' in (r.conditions as object)) || ('user_id' in (r.conditions as object))))) return 'own';
  return null;
};

// ---------------------------------------------------------------------------
// Assignment guard — "you can't grant power you don't hold"
// ---------------------------------------------------------------------------

/**
 * True iff `ability` is permitted to hand out every grant in `targetPatterns`.
 * For each catalog-valid (subject, action) the patterns expand to, the assigner
 * must hold that pair at an equal-or-broader scope. Replaces all ad-hoc
 * isAdmin / maxScope / slug escalation checks.
 */
export const canAssignGrants = (
  ability: AppAbility,
  targetPatterns: string[],
  catalog: PermissionSeed[],
): boolean => {
  const effective = expandToEffective(targetPatterns, catalog);
  for (const g of effective.values()) {
    const have = getScopeFor(ability, g.action, g.subject);
    if (have === null || SCOPE_RANK[have] < SCOPE_RANK[g.scope]) return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Compression: minimal equivalent pattern set for storage
// ---------------------------------------------------------------------------

/**
 * Fold a pattern set into the minimal equivalent using catalog knowledge:
 *   subject:action:scope × all-actions  → subject:*:scope
 *   subject:*:scope × all-subjects       → *:*:scope
 *   *:*:platform                          → subsumes everything
 * Also drops patterns already subsumed by a wildcard in the input.
 * Guaranteed lossless: expand(compress(P)) === expand(P).
 */
export const compressPatterns = (
  patterns: string[],
  catalog: PermissionSeed[],
): string[] => {
  if (patterns.includes('*:*:platform')) return ['*:*:platform'];

  const idx = buildCatalogIndex(catalog);
  const working = new Set(patterns.filter((p) => parsePattern(p) !== null));

  // Phase 1: drop patterns already covered by a wildcard in the input
  for (const p of Array.from(working)) {
    const parsed = parsePattern(p)!;
    const { subjCode, action, scope } = parsed;
    if (subjCode === '*' && action === '*') continue;
    if (working.has(`*:*:${scope}`)) { working.delete(p); continue; }
    if (action !== '*' && working.has(`${subjCode}:*:${scope}`)) { working.delete(p); continue; }
  }

  // Phase 2: subject:action:scope → subject:*:scope when all catalog actions present
  for (const [subject, scopeMap] of idx.actionsBySubjectScope) {
    const code = ENUM_TO_SUBJECT_CODE[subject as string];
    if (!code) continue;
    for (const [scope, actions] of scopeMap) {
      if (working.has(`*:*:${scope}`) || working.has(`${code}:*:${scope}`)) continue;
      if (actions.size === 0) continue;
      if ([...actions].every((a) => working.has(`${code}:${a}:${scope}`))) {
        for (const a of actions) working.delete(`${code}:${a}:${scope}`);
        working.add(`${code}:*:${scope}`);
      }
    }
  }

  // Phase 3: subject:*:scope × all-subjects-at-scope → *:*:scope
  for (const scope of SCOPES) {
    if (working.has(`*:*:${scope}`)) continue;
    const subjectsAtScope = idx.subjectsByScope.get(scope);
    if (!subjectsAtScope || subjectsAtScope.size === 0) continue;
    const codes = [...subjectsAtScope].map((s) => ENUM_TO_SUBJECT_CODE[s as string]);
    if (codes.every((code) => working.has(`${code}:*:${scope}`))) {
      for (const code of codes) working.delete(`${code}:*:${scope}`);
      working.add(`*:*:${scope}`);
    }
  }

  return Array.from(working);
};

// ---------------------------------------------------------------------------
// Pattern validation
// ---------------------------------------------------------------------------

/** True if the pattern is syntactically valid and matches the catalog at its scope. */
export const isValidPattern = (pattern: string, catalog: PermissionSeed[]): boolean => {
  const parsed = parsePattern(pattern);
  if (!parsed) return false;
  const { subjCode, action, scope } = parsed;

  return catalog.some((p) => {
    const matchesSubject = subjCode === '*' || toSubjectCode(p.subject) === subjCode;
    const matchesAction = action === '*' || p.action === action;
    return matchesSubject && matchesAction && p.scopes.includes(scope);
  });
};
