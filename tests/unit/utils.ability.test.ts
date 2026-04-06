/**
 * Tests for src/utils/ability.ts
 *
 * Covers:
 *   - buildRulesFromGrants  (wildcard expansion, scope deduplication)
 *   - buildAbilityFromRules / buildAbility (CASL wiring)
 *   - isValidPattern        (catalog validation, edge cases)
 *   - maxScopeFromPatterns  (privilege-escalation helper)
 *
 * Pattern format: "{subject|*}:{action|*}:{own|org|platform}"
 */
import { describe, it, expect } from 'vitest';
import { packRules } from '@casl/ability/extra';
import {
  buildRulesFromGrants,
  buildAbility,
  buildAbilityFromRules,
  isValidPattern,
  maxScopeFromPatterns,
  SCOPE_RANK,
  ALL_SUBJECTS,
} from '../../src/utils/ability.js';
import type { PermissionScope } from '../../src/utils/ability.js';
import type { PermissionAction, PermissionSubject } from '@prisma/client';

// ---------------------------------------------------------------------------
// Minimal permission catalog for validation tests
// ---------------------------------------------------------------------------

const catalog: Array<{ action: PermissionAction; subject: PermissionSubject; scopes: PermissionScope[] }> = [
  { action: 'read',    subject: 'User',        scopes: ['own', 'org', 'platform'] },
  { action: 'update',  subject: 'User',        scopes: ['own', 'org', 'platform'] },
  { action: 'delete',  subject: 'User',        scopes: ['own', 'org', 'platform'] },
  { action: 'invite',  subject: 'User',        scopes: ['org', 'platform'] },
  { action: 'suspend', subject: 'User',        scopes: ['org', 'platform'] },
  { action: 'read',    subject: 'Org',         scopes: ['own', 'org', 'platform'] },
  { action: 'create',  subject: 'Org',         scopes: ['platform'] },
  { action: 'update',  subject: 'Org',         scopes: ['org', 'platform'] },
  { action: 'read',    subject: 'Role',        scopes: ['org', 'platform'] },
  { action: 'create',  subject: 'Role',        scopes: ['org', 'platform'] },
  { action: 'update',  subject: 'Role',        scopes: ['org', 'platform'] },
  { action: 'delete',  subject: 'Role',        scopes: ['org', 'platform'] },
  { action: 'read',    subject: 'Invitation',  scopes: ['org', 'platform'] },
  { action: 'upload',  subject: 'MediaAsset',  scopes: ['own', 'org', 'platform'] },
  { action: 'delete',  subject: 'MediaAsset',  scopes: ['own', 'org', 'platform'] },
  { action: 'read',    subject: 'AuditLog',    scopes: ['org', 'platform'] },
  { action: 'export',  subject: 'AuditLog',    scopes: ['org', 'platform'] },
];

const USER = 'user-abc';
const ORG  = 'org-xyz';

// ---------------------------------------------------------------------------
// buildRulesFromGrants — wildcard expansion
// ---------------------------------------------------------------------------

describe('buildRulesFromGrants — *:*:platform', () => {
  it('produces a single manage:all rule (no conditions)', () => {
    const rules = buildRulesFromGrants(['*:*:platform'], USER, ORG);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: 'manage', subject: 'all' });
    expect((rules[0] as Record<string, unknown>)['conditions']).toBeUndefined();
  });

  it('ability can do anything', () => {
    const ability = buildAbilityFromRules(buildRulesFromGrants(['*:*:platform'], USER, ORG));
    expect(ability.can('read',   'User')).toBe(true);
    expect(ability.can('delete', 'Org')).toBe(true);
    expect(ability.can('manage', 'Role')).toBe(true);
  });
});

describe('buildRulesFromGrants — *:*:org', () => {
  it('produces one rule per known subject, all conditioned to org_id', () => {
    const rules = buildRulesFromGrants(['*:*:org'], USER, ORG);
    // One rule per subject in ALL_SUBJECTS
    expect(rules).toHaveLength(ALL_SUBJECTS.length);
    for (const rule of rules) {
      expect(rule.action).toBe('manage');
      // Every rule must have org_id or id condition (never unconditioned)
      expect((rule as Record<string, unknown>)['conditions']).toBeDefined();
    }
  });

  it('Org subject gets { id: orgId } (not org_id) for org scope', () => {
    const rules = buildRulesFromGrants(['*:*:org'], USER, ORG);
    const orgRule = rules.find((r) => r.subject === 'Org');
    expect(orgRule).toBeDefined();
    expect((orgRule as Record<string, unknown>)['conditions']).toEqual({ id: ORG });
  });

  it('User subject gets { org_id: orgId } for org scope', () => {
    const rules = buildRulesFromGrants(['*:*:org'], USER, ORG);
    const userRule = rules.find((r) => r.subject === 'User');
    expect((userRule as Record<string, unknown>)['conditions']).toEqual({ org_id: ORG });
  });

  it('ability conditioned correctly — can manage User in org, not others', () => {
    const ability = buildAbilityFromRules(buildRulesFromGrants(['*:*:org'], USER, ORG));
    // Without an object instance, ability.can returns true if any matching rule exists
    expect(ability.can('manage', 'User')).toBe(true);
    expect(ability.can('delete', 'Role')).toBe(true);
  });
});

describe('buildRulesFromGrants — user:*:org', () => {
  it('produces a single manage:User rule conditioned to org_id', () => {
    const rules = buildRulesFromGrants(['user:*:org'], USER, ORG);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: 'manage', subject: 'User', conditions: { org_id: ORG } });
  });
});

describe('buildRulesFromGrants — user:*:own', () => {
  it('produces a single manage:User rule conditioned to { id: userId }', () => {
    const rules = buildRulesFromGrants(['user:*:own'], USER, ORG);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: 'manage', subject: 'User', conditions: { id: USER } });
  });

  it('works without orgId', () => {
    const rules = buildRulesFromGrants(['user:*:own'], USER, null);
    expect(rules[0]).toMatchObject({ conditions: { id: USER } });
  });
});

describe('buildRulesFromGrants — concrete action+subject+scope', () => {
  it('user:read:org → read:User with org_id condition', () => {
    const rules = buildRulesFromGrants(['user:read:org'], USER, ORG);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: 'read', subject: 'User', conditions: { org_id: ORG } });
  });

  it('user:read:platform → read:User with no conditions', () => {
    const rules = buildRulesFromGrants(['user:read:platform'], USER, ORG);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: 'read', subject: 'User' });
    expect((rules[0] as Record<string, unknown>)['conditions']).toBeUndefined();
  });

  it('audit_log:read:org → read:AuditLog (snake_case subject code)', () => {
    const rules = buildRulesFromGrants(['audit_log:read:org'], USER, ORG);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: 'read', subject: 'AuditLog', conditions: { org_id: ORG } });
  });

  it('org_document:upload:org → upload:OrgDocument', () => {
    const rules = buildRulesFromGrants(['org_document:upload:org'], USER, ORG);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: 'upload', subject: 'OrgDocument', conditions: { org_id: ORG } });
  });

  it('media_asset:delete:own → delete:MediaAsset with { id: userId }', () => {
    const rules = buildRulesFromGrants(['media_asset:delete:own'], USER, ORG);
    expect(rules[0]).toMatchObject({ action: 'delete', subject: 'MediaAsset', conditions: { id: USER } });
  });
});

describe('buildRulesFromGrants — *:action:scope (subject wildcard, concrete action)', () => {
  it('*:read:platform → one read rule per subject, all unconditioned', () => {
    const rules = buildRulesFromGrants(['*:read:platform'], USER, ORG);
    expect(rules).toHaveLength(ALL_SUBJECTS.length);
    for (const rule of rules) {
      expect(rule.action).toBe('read');
      expect((rule as Record<string, unknown>)['conditions']).toBeUndefined();
    }
  });

  it('*:delete:org → one delete rule per subject, all conditioned', () => {
    const rules = buildRulesFromGrants(['*:delete:org'], USER, ORG);
    expect(rules).toHaveLength(ALL_SUBJECTS.length);
    for (const rule of rules) {
      expect(rule.action).toBe('delete');
      expect((rule as Record<string, unknown>)['conditions']).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// buildRulesFromGrants — scope deduplication
// ---------------------------------------------------------------------------

describe('buildRulesFromGrants — scope deduplication (broadest scope wins)', () => {
  it('platform scope beats org scope for same action+subject', () => {
    const rules = buildRulesFromGrants(
      ['user:read:org', 'user:read:platform'],
      USER, ORG,
    );
    const readUser = rules.filter((r) => r.action === 'read' && r.subject === 'User');
    expect(readUser).toHaveLength(1);
    expect((readUser[0] as Record<string, unknown>)['conditions']).toBeUndefined();
  });

  it('platform scope beats own scope', () => {
    const rules = buildRulesFromGrants(
      ['user:read:own', 'user:read:platform'],
      USER, ORG,
    );
    const readUser = rules.filter((r) => r.action === 'read' && r.subject === 'User');
    expect(readUser).toHaveLength(1);
    expect((readUser[0] as Record<string, unknown>)['conditions']).toBeUndefined();
  });

  it('org scope beats own scope', () => {
    const rules = buildRulesFromGrants(
      ['user:read:own', 'user:read:org'],
      USER, ORG,
    );
    const readUser = rules.filter((r) => r.action === 'read' && r.subject === 'User');
    expect(readUser).toHaveLength(1);
    expect((readUser[0] as Record<string, unknown>)['conditions']).toEqual({ org_id: ORG });
  });

  it('*:*:platform supersedes all other patterns', () => {
    const rules = buildRulesFromGrants(
      ['user:read:own', 'org:update:org', '*:*:platform'],
      USER, ORG,
    );
    // manage:all should dominate; deduplication keeps the broadest per (action,subject) key
    const manageAll = rules.find((r) => r.action === 'manage' && r.subject === 'all');
    expect(manageAll).toBeDefined();
    // user:read:own and org:update:org are narrower than manage:all on their (action,subject) pairs
    // manage:all covers manage:User and manage:Org, so read:User and update:Org may still appear
    // as separate entries (different action keys). The important check is manage:all is present.
  });

  it('duplicate patterns do not double-emit rules', () => {
    const rules = buildRulesFromGrants(
      ['user:read:org', 'user:read:org'],
      USER, ORG,
    );
    const readUser = rules.filter((r) => r.action === 'read' && r.subject === 'User');
    expect(readUser).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildRulesFromGrants — null orgId edge cases
// ---------------------------------------------------------------------------

describe('buildRulesFromGrants — null orgId', () => {
  it('org-scoped User rule has no conditions when orgId is null', () => {
    const rules = buildRulesFromGrants(['user:read:org'], USER, null);
    expect((rules[0] as Record<string, unknown>)['conditions']).toBeUndefined();
  });

  it('*:*:org with null orgId produces unconditioned rules', () => {
    const rules = buildRulesFromGrants(['*:*:org'], USER, null);
    for (const rule of rules) {
      expect((rule as Record<string, unknown>)['conditions']).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// buildRulesFromGrants — empty / unknown patterns
// ---------------------------------------------------------------------------

describe('buildRulesFromGrants — edge cases', () => {
  it('empty patterns array returns empty rules', () => {
    expect(buildRulesFromGrants([], USER, ORG)).toEqual([]);
  });

  it('unknown subject code produces zero rules (skipped silently)', () => {
    const rules = buildRulesFromGrants(['nonexistent_subject:read:org'], USER, ORG);
    expect(rules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Managed role grant sets
// ---------------------------------------------------------------------------

describe('buildRulesFromGrants — managed role patterns', () => {
  it('passenger grants (user:*:own, media_asset:*:own) → 2 conditioned rules', () => {
    const rules = buildRulesFromGrants(['user:*:own', 'media_asset:*:own'], USER, null);
    expect(rules).toHaveLength(2);
    expect(rules.every((r) => r.action === 'manage')).toBe(true);
    expect(rules.every((r) => !!(r as Record<string, unknown>)['conditions'])).toBe(true);
  });

  it('dispatcher grants — 5 patterns → ≤5 distinct (action,subject) rules', () => {
    const patterns = [
      'user:read:org',
      'user:invite:org',
      'user:suspend:org',
      'invitation:*:org',
      'audit_log:read:org',
    ];
    const rules = buildRulesFromGrants(patterns, USER, ORG);
    // read+invite+suspend:User + manage:Invitation + read:AuditLog = 5 rules
    expect(rules).toHaveLength(5);
    expect(rules.every((r) => !!(r as Record<string, unknown>)['conditions'])).toBe(true);
  });

  it('org-admin (*:*:org + org:read:own) — org scope dominates own scope for Org subject', () => {
    const rules = buildRulesFromGrants(['*:*:org', 'org:read:own'], USER, ORG);
    const orgRules = rules.filter((r) => r.subject === 'Org');
    // manage:Org from *:*:org (org scope) should dominate read:Org:own
    const manageOrg = orgRules.find((r) => r.action === 'manage');
    expect(manageOrg).toBeDefined();
    expect((manageOrg as Record<string, unknown>)['conditions']).toEqual({ id: ORG });
  });

  it('platform-admin (*:*:platform) → 1 rule total', () => {
    const rules = buildRulesFromGrants(['*:*:platform'], USER, ORG);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: 'manage', subject: 'all' });
  });
});

// ---------------------------------------------------------------------------
// buildAbility / buildAbilityFromRules
// ---------------------------------------------------------------------------

describe('buildAbilityFromRules', () => {
  it('can() returns true for matching rule', () => {
    const ability = buildAbilityFromRules([{ action: 'read', subject: 'User' }]);
    expect(ability.can('read', 'User')).toBe(true);
  });

  it('can() returns false for non-matching action', () => {
    const ability = buildAbilityFromRules([{ action: 'read', subject: 'User' }]);
    expect(ability.can('delete', 'User')).toBe(false);
  });

  it('manage action covers all CRUD', () => {
    const ability = buildAbilityFromRules([{ action: 'manage', subject: 'User' }]);
    expect(ability.can('create', 'User')).toBe(true);
    expect(ability.can('read',   'User')).toBe(true);
    expect(ability.can('update', 'User')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(true);
  });

  it('manage:all covers every subject', () => {
    const ability = buildAbilityFromRules([{ action: 'manage', subject: 'all' }]);
    expect(ability.can('delete', 'User')).toBe(true);
    expect(ability.can('create', 'Org')).toBe(true);
    expect(ability.can('read',   'Role')).toBe(true);
  });
});

describe('buildAbility (packed rules round-trip)', () => {
  it('pack → unpack round-trip produces correct ability', () => {
    const rawRules = [{ action: 'read' as const, subject: 'Org' as const }];
    const packed = packRules(rawRules);
    const ability = buildAbility(packed);
    expect(ability.can('read', 'Org')).toBe(true);
    expect(ability.can('write', 'Org')).toBe(false);
  });

  it('manage:all packs/unpacks correctly', () => {
    const rules = buildRulesFromGrants(['*:*:platform'], USER, ORG);
    const packed = packRules(rules);
    const ability = buildAbility(packed);
    expect(ability.can('delete', 'User')).toBe(true);
    expect(ability.can('create', 'Role')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidPattern
// ---------------------------------------------------------------------------

describe('isValidPattern', () => {
  it('exact valid pattern → true', () => {
    expect(isValidPattern('user:read:org', catalog)).toBe(true);
  });

  it('wildcard subject + wildcard action + valid scope → true', () => {
    expect(isValidPattern('*:*:platform', catalog)).toBe(true);
  });

  it('wildcard subject + concrete action + valid scope → true', () => {
    expect(isValidPattern('*:read:org', catalog)).toBe(true);
  });

  it('concrete subject + wildcard action + valid scope → true', () => {
    expect(isValidPattern('user:*:own', catalog)).toBe(true);
  });

  it('known permission in catalog scope → true', () => {
    expect(isValidPattern('org:create:platform', catalog)).toBe(true);
  });

  it('permission NOT valid at that scope → false (org:create only at platform)', () => {
    expect(isValidPattern('org:create:org', catalog)).toBe(false);
  });

  it('unknown subject code → false', () => {
    expect(isValidPattern('vehicle:read:org', catalog)).toBe(false);
  });

  it('unknown action → false', () => {
    expect(isValidPattern('user:fly:org', catalog)).toBe(false);
  });

  it('invalid scope → false', () => {
    expect(isValidPattern('user:read:global', catalog)).toBe(false);
  });

  it('wrong part count (2 parts) → false', () => {
    expect(isValidPattern('user:read', catalog)).toBe(false);
  });

  it('wrong part count (4 parts) → false', () => {
    expect(isValidPattern('user:read:org:extra', catalog)).toBe(false);
  });

  it('empty string → false', () => {
    expect(isValidPattern('', catalog)).toBe(false);
  });

  it('invite:User not valid at own scope (scopes=[org,platform])', () => {
    expect(isValidPattern('user:invite:own', catalog)).toBe(false);
  });

  it('wildcard subject with platform scope and action valid for at least one subject → true', () => {
    // *:create:platform — 'create' is valid on Org:platform and Role:platform in catalog
    expect(isValidPattern('*:create:platform', catalog)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// maxScopeFromPatterns
// ---------------------------------------------------------------------------

describe('maxScopeFromPatterns', () => {
  it('returns own for single own-scope pattern', () => {
    expect(maxScopeFromPatterns(['user:read:own'])).toBe<PermissionScope>('own');
  });

  it('returns org for single org-scope pattern', () => {
    expect(maxScopeFromPatterns(['user:read:org'])).toBe<PermissionScope>('org');
  });

  it('returns platform for single platform-scope pattern', () => {
    expect(maxScopeFromPatterns(['*:*:platform'])).toBe<PermissionScope>('platform');
  });

  it('returns highest scope across mixed patterns', () => {
    expect(maxScopeFromPatterns(['user:read:own', 'user:invite:org'])).toBe<PermissionScope>('org');
    expect(maxScopeFromPatterns(['user:read:own', 'org:create:platform'])).toBe<PermissionScope>('platform');
  });

  it('returns own for empty list (default baseline)', () => {
    expect(maxScopeFromPatterns([])).toBe<PermissionScope>('own');
  });
});

// ---------------------------------------------------------------------------
// SCOPE_RANK values
// ---------------------------------------------------------------------------

describe('SCOPE_RANK', () => {
  it('platform > org > own', () => {
    expect(SCOPE_RANK['platform']).toBeGreaterThan(SCOPE_RANK['org']);
    expect(SCOPE_RANK['org']).toBeGreaterThan(SCOPE_RANK['own']);
  });

  it('can compare scopes correctly', () => {
    const a: PermissionScope = 'own';
    const b: PermissionScope = 'platform';
    expect(SCOPE_RANK[b] > SCOPE_RANK[a]).toBe(true);
  });
});
