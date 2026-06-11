/**
 * Tests for src/utils/ability.ts — the catalog-driven authorization core.
 *
 * Focus areas:
 *   - subject map covers every Prisma subject (regression for the dropped-rules bug)
 *   - lossless compress/expand:  effective(compress(P)) === effective(P)
 *   - safe `manage` emission (never over-grants platform-only actions at org scope)
 *   - self-contained scope conditions (User→id, Org→id, others→user_id/org_id)
 *   - canAssignGrants ("can't grant power you don't hold")
 */
import { describe, it, expect } from 'vitest';
import {
  buildRulesFromGrants,
  buildAbilityFromRules,
  expandToEffective,
  compressPatterns,
  isValidPattern,
  canAssignGrants,
  getScopeFor,
  SUBJECT_CODE_TO_ENUM,
  ALL_SUBJECTS,
  toSubjectCode,
} from '../../src/utils/ability.js';
import { PERMISSIONS } from '../../src/utils/catalog.js';

const USER = 'user-abc';
const ORG = 'org-xyz';

const rulesFor = (patterns: string[], userId = USER, orgId: string | null = ORG) =>
  buildRulesFromGrants(patterns, userId, orgId, PERMISSIONS);

const abilityFor = (patterns: string[], userId = USER, orgId: string | null = ORG) =>
  buildAbilityFromRules(rulesFor(patterns, userId, orgId));

const effectiveSet = (patterns: string[]) =>
  new Set([...expandToEffective(patterns, PERMISSIONS).values()].map((g) => `${g.subject}:${g.action}:${g.scope}`));

// Representative org-admin grant set (org scope, no platform powers).
const ORG_ADMIN = [
  'user:*:org', 'org:read:org', 'org:update:org', 'role:*:org', 'invitation:*:org',
  'trip:*:org', 'route:*:org', 'bus:*:org', 'ticket:*:org', 'price:read:org',
  'finance:read:org', 'finance:export:org', 'billing:read:org', 'billing:pay:org',
  'payout:read:org', 'payment:read:org', 'refund:read:org', 'report:*:org',
  'audit_log:read:org', 'notification:receive:org', 'notification:configure:org',
  'org_document:*:org',
];
const PASSENGER = [
  'ticket:read:own', 'ticket:cancel:own', 'wallet:read:own', 'wallet:topup:own',
  'payment:read:own', 'user:read:own', 'user:update:own', 'notification:receive:own',
];

// ---------------------------------------------------------------------------
// Subject map completeness — the original bug
// ---------------------------------------------------------------------------

describe('subject map', () => {
  it('maps every Prisma subject (auto-derived, no drift)', () => {
    for (const subj of ALL_SUBJECTS) {
      expect(SUBJECT_CODE_TO_ENUM[toSubjectCode(subj)]).toBe(subj);
    }
    expect(Object.keys(SUBJECT_CODE_TO_ENUM)).toHaveLength(ALL_SUBJECTS.length);
  });

  it('expands financial/trip subjects that the old 7-subject map dropped', () => {
    // These all previously produced ZERO rules — the central bug.
    expect(abilityFor(['trip:read:own']).can('read', 'Trip')).toBe(true);
    expect(abilityFor(['ticket:read:own']).can('read', 'Ticket')).toBe(true);
    expect(abilityFor(['wallet:read:own']).can('read', 'Wallet')).toBe(true);
    expect(abilityFor(['finance:read:org']).can('read', 'Finance')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Platform god-mode
// ---------------------------------------------------------------------------

describe('*:*:platform', () => {
  it('collapses to a single manage-all rule', () => {
    const rules = rulesFor(['*:*:platform']);
    expect(rules).toEqual([{ action: 'manage', subject: 'all' }]);
  });

  it('reaches own-only subjects like Wallet (catalog-independent god mode)', () => {
    const ability = abilityFor(['*:*:platform']);
    expect(ability.can('read', 'Wallet')).toBe(true);
    expect(ability.can('provision', 'Vsdc')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lossless compression/expansion
// ---------------------------------------------------------------------------

describe('compress/expand is lossless', () => {
  const cases: Record<string, string[]> = {
    'org admin': ORG_ADMIN,
    passenger: PASSENGER,
    'all user actions at org': ['user:read:org', 'user:create:org', 'user:update:org', 'user:delete:org', 'user:invite:org', 'user:suspend:org', 'user:assign_role:org'],
    'mixed wildcards': ['trip:*:org', 'ticket:read:org', 'ticket:create:org'],
  };

  for (const [name, patterns] of Object.entries(cases)) {
    it(`effective(compress(P)) === effective(P) — ${name}`, () => {
      expect(effectiveSet(compressPatterns(patterns, PERMISSIONS))).toEqual(effectiveSet(patterns));
    });
  }

  it('folds every user action at org into user:*:org', () => {
    const all = ['user:read:org', 'user:create:org', 'user:update:org', 'user:delete:org', 'user:invite:org', 'user:suspend:org', 'user:assign_role:org'];
    expect(compressPatterns(all, PERMISSIONS)).toEqual(['user:*:org']);
  });

  it('collapses *:*:platform from a fully-covered platform set', () => {
    expect(compressPatterns(['*:*:platform', 'user:read:own'], PERMISSIONS)).toEqual(['*:*:platform']);
  });
});

// ---------------------------------------------------------------------------
// Safe manage emission — never over-grants
// ---------------------------------------------------------------------------

describe('manage emission safety', () => {
  it('emits manage for a fully-held subject (user:*:org)', () => {
    const rules = rulesFor(['user:*:org']);
    const userRule = rules.find((r) => r.subject === 'User');
    expect(userRule?.action).toBe('manage');
    expect(userRule?.conditions).toEqual({ org_id: ORG });
  });

  it('does NOT grant platform-only actions to an org admin', () => {
    const ability = abilityFor(ORG_ADMIN);
    expect(ability.can('update', 'Org')).toBe(true);   // org-scoped
    expect(ability.can('delete', 'Org')).toBe(false);  // platform-only — must stay false
    expect(ability.can('suspend', 'Org')).toBe(false); // platform-only
    expect(ability.can('create', 'Price')).toBe(false); // price create is platform-only
    expect(ability.can('read', 'Price')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Self-contained scope conditions
// ---------------------------------------------------------------------------

describe('scope conditions', () => {
  it('own User uses {id}, own Wallet uses {user_id}', () => {
    const userRule = rulesFor(['user:read:own']).find((r) => r.subject === 'User');
    expect(userRule?.conditions).toEqual({ id: USER });
    const walletRule = rulesFor(['wallet:read:own']).find((r) => r.subject === 'Wallet');
    expect(walletRule?.conditions).toEqual({ user_id: USER });
  });

  it('org subjects use {org_id}, Org itself uses {id}', () => {
    const tripRule = rulesFor(['trip:read:org']).find((r) => r.subject === 'Trip');
    expect(tripRule?.conditions).toEqual({ org_id: ORG });
    const orgRule = rulesFor(['org:read:org']).find((r) => r.subject === 'Org');
    expect(orgRule?.conditions).toEqual({ id: ORG });
  });

  it('platform scope carries no condition', () => {
    const rule = rulesFor(['user:read:platform']).find((r) => r.subject === 'User');
    expect(rule?.conditions).toBeUndefined();
    expect(getScopeFor(abilityFor(['user:read:platform']), 'read', 'User')).toBe('platform');
  });
});

// ---------------------------------------------------------------------------
// canAssignGrants — escalation guard
// ---------------------------------------------------------------------------

describe('canAssignGrants', () => {
  const platform = abilityFor(['*:*:platform']);
  const orgAdmin = abilityFor(ORG_ADMIN);

  it('platform admin can assign anything', () => {
    expect(canAssignGrants(platform, ['*:*:platform'], PERMISSIONS)).toBe(true);
    expect(canAssignGrants(platform, PASSENGER, PERMISSIONS)).toBe(true);
    expect(canAssignGrants(platform, ORG_ADMIN, PERMISSIONS)).toBe(true);
  });

  it('org admin CANNOT assign platform-admin (fixes the invite escalation)', () => {
    expect(canAssignGrants(orgAdmin, ['*:*:platform'], PERMISSIONS)).toBe(false);
  });

  it('org admin CANNOT assign passenger (lacks wallet/own grants) — replaces slug hiding', () => {
    expect(canAssignGrants(orgAdmin, PASSENGER, PERMISSIONS)).toBe(false);
  });

  it('org admin CAN assign org-scoped roles it holds', () => {
    expect(canAssignGrants(orgAdmin, ['user:read:org', 'trip:create:org'], PERMISSIONS)).toBe(true);
  });

  it('cannot grant a broader scope than held (own holder cannot grant org)', () => {
    const ownOnly = abilityFor(['ticket:read:own'], USER, null);
    expect(canAssignGrants(ownOnly, ['ticket:read:org'], PERMISSIONS)).toBe(false);
    expect(canAssignGrants(ownOnly, ['ticket:read:own'], PERMISSIONS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidPattern — new action set
// ---------------------------------------------------------------------------

describe('isValidPattern', () => {
  it('accepts the new lifecycle actions', () => {
    expect(isValidPattern('notification:configure:own', PERMISSIONS)).toBe(true);
    expect(isValidPattern('vsdc:provision:platform', PERMISSIONS)).toBe(true);
    expect(isValidPattern('ticket:validate:org', PERMISSIONS)).toBe(true);
  });

  it('rejects the removed literal manage action', () => {
    expect(isValidPattern('notification:manage:own', PERMISSIONS)).toBe(false);
  });

  it('rejects unknown subjects, bad scopes, and wrong arity', () => {
    expect(isValidPattern('dragon:read:org', PERMISSIONS)).toBe(false);
    expect(isValidPattern('user:read:galaxy', PERMISSIONS)).toBe(false);
    expect(isValidPattern('user:read', PERMISSIONS)).toBe(false);
  });

  it('rejects an action at a scope the catalog disallows', () => {
    expect(isValidPattern('org:delete:org', PERMISSIONS)).toBe(false); // delete is platform-only
    expect(isValidPattern('org:delete:platform', PERMISSIONS)).toBe(true);
  });
});
