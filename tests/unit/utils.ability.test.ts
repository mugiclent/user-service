/**
 * Tests for src/utils/ability.ts
 * Covers: collectPermissions, buildRulesForUser, buildAbility, buildAbilityFromRules
 */
import { describe, it, expect } from 'vitest';
import { packRules } from '@casl/ability/extra';
import {
  collectPermissions,
  buildRulesForUser,
  buildAbility,
  buildAbilityFromRules,
} from '../../src/utils/ability.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const makeUser = (roleSlugs: string[], permissions: Array<{ level: string; subject: string }> = []) => ({
  id: 'user-1',
  org_id: 'org-1',
  user_roles: roleSlugs.map((slug) => ({
    role: {
      slug,
      role_permissions: permissions.map((p) => ({
        permission: { level: p.level, subject: p.subject },
      })),
    },
  })),
  user_permissions: [] as Array<{ permission: { level: string; subject: string } }>,
});

const makeUserWithDirectGrant = (level: string, subject: string) => ({
  id: 'user-1',
  org_id: null,
  user_roles: [],
  user_permissions: [{ permission: { level, subject } }],
});

// ── collectPermissions ────────────────────────────────────────────────────────

describe('collectPermissions', () => {
  it('returns empty array for user with no roles or permissions', () => {
    const user = { id: 'u', org_id: null, user_roles: [], user_permissions: [] };
    expect(collectPermissions(user as never)).toEqual([]);
  });

  it('collects permissions from a single role', () => {
    const user = makeUser(['org_admin'], [{ level: 'manage', subject: 'User' }]);
    const entries = collectPermissions(user as never);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: 'manage', subject: 'User', roleSlugs: ['org_admin'] });
  });

  it('merges same level+subject from multiple roles into one entry', () => {
    const user = {
      id: 'u', org_id: 'o',
      user_roles: [
        { role: { slug: 'org_admin', role_permissions: [{ permission: { level: 'manage', subject: 'User' } }] } },
        { role: { slug: 'dispatcher', role_permissions: [{ permission: { level: 'manage', subject: 'User' } }] } },
      ],
      user_permissions: [],
    };
    const entries = collectPermissions(user as never);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.roleSlugs).toEqual(['org_admin', 'dispatcher']);
  });

  it('keeps separate entries for different level+subject pairs', () => {
    const user = makeUser(['org_admin'], [
      { level: 'manage', subject: 'User' },
      { level: 'write', subject: 'Org' },
    ]);
    const entries = collectPermissions(user as never);
    expect(entries).toHaveLength(2);
  });

  it('adds direct user grants with __direct__ sentinel', () => {
    const user = makeUserWithDirectGrant('read', 'Org');
    const entries = collectPermissions(user as never);
    expect(entries[0]).toMatchObject({ level: 'read', subject: 'Org', roleSlugs: ['__direct__'] });
  });

  it('merges direct grant into existing role entry', () => {
    const user = {
      id: 'u', org_id: 'o',
      user_roles: [{ role: { slug: 'org_admin', role_permissions: [{ permission: { level: 'read', subject: 'Org' } }] } }],
      user_permissions: [{ permission: { level: 'read', subject: 'Org' } }],
    };
    const entries = collectPermissions(user as never);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.roleSlugs).toContain('__direct__');
    expect(entries[0]!.roleSlugs).toContain('org_admin');
  });
});

// ── buildRulesForUser ─────────────────────────────────────────────────────────

describe('buildRulesForUser', () => {
  it('returns empty rules for empty entries', () => {
    expect(buildRulesForUser('u', null, [])).toEqual([]);
  });

  it('manage:all → single manage rule with no conditions (katisha_super_admin)', () => {
    const entries = [{ level: 'manage' as const, subject: 'all', roleSlugs: ['katisha_super_admin'] }];
    const rules = buildRulesForUser('u', null, entries);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: 'manage', subject: 'all' });
    expect((rules[0] as Record<string, unknown>)['conditions']).toBeUndefined();
  });

  it('manage:User for katisha_admin → unconditioned manage rule', () => {
    const entries = [{ level: 'manage' as const, subject: 'User', roleSlugs: ['katisha_admin'] }];
    const rules = buildRulesForUser('u', 'o', entries);
    expect(rules[0]).toMatchObject({ action: 'manage', subject: 'User' });
    expect((rules[0] as Record<string, unknown>)['conditions']).toBeUndefined();
  });

  it('write:User → expands to create, read, update (3 rules)', () => {
    const entries = [{ level: 'write' as const, subject: 'User', roleSlugs: ['katisha_admin'] }];
    const rules = buildRulesForUser('u', null, entries);
    const actions = rules.map((r) => r.action);
    expect(actions).toContain('create');
    expect(actions).toContain('read');
    expect(actions).toContain('update');
    expect(actions).not.toContain('delete');
  });

  it('read:Org → single read rule', () => {
    const entries = [{ level: 'read' as const, subject: 'Org', roleSlugs: ['katisha_support'] }];
    const rules = buildRulesForUser('u', null, entries);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: 'read', subject: 'Org' });
  });

  it('passenger write:User → omits create (self-only role)', () => {
    const entries = [{ level: 'write' as const, subject: 'User', roleSlugs: ['passenger'] }];
    const rules = buildRulesForUser('user-42', null, entries);
    const actions = rules.map((r) => r.action);
    expect(actions).not.toContain('create');
    expect(actions).toContain('read');
    expect(actions).toContain('update');
  });

  it('driver write:User → omits create, adds { id: userId } condition', () => {
    const entries = [{ level: 'write' as const, subject: 'User', roleSlugs: ['driver'] }];
    const rules = buildRulesForUser('drv-1', null, entries);
    for (const r of rules) {
      expect((r as Record<string, unknown>)['conditions']).toEqual({ id: 'drv-1' });
    }
  });

  it('org_admin manage:User → conditioned { org_id: orgId }', () => {
    const entries = [{ level: 'manage' as const, subject: 'User', roleSlugs: ['org_admin'] }];
    const rules = buildRulesForUser('u', 'org-99', entries);
    expect(rules[0]).toMatchObject({ action: 'manage', subject: 'User', conditions: { org_id: 'org-99' } });
  });

  it('org_admin write:Org → conditioned { id: orgId } (Org primary key, not foreign key)', () => {
    const entries = [{ level: 'write' as const, subject: 'Org', roleSlugs: ['org_admin'] }];
    const rules = buildRulesForUser('u', 'org-99', entries);
    for (const r of rules) {
      expect((r as Record<string, unknown>)['conditions']).toEqual({ id: 'org-99' });
    }
  });

  it('org_admin with no orgId → unconditioned (null orgId returns undefined from fn → unrestricted)', () => {
    const entries = [{ level: 'manage' as const, subject: 'User', roleSlugs: ['org_admin'] }];
    const rules = buildRulesForUser('u', null, entries);
    expect((rules[0] as Record<string, unknown>)['conditions']).toBeUndefined();
  });

  it('direct grant (__direct__) → unconditioned regardless of subject', () => {
    const entries = [{ level: 'read' as const, subject: 'Org', roleSlugs: ['__direct__'] }];
    const rules = buildRulesForUser('u', 'org-1', entries);
    expect((rules[0] as Record<string, unknown>)['conditions']).toBeUndefined();
  });

  it('mixed roles: one conditioned + one unconditioned → unconditioned wins', () => {
    const entries = [{ level: 'read' as const, subject: 'User', roleSlugs: ['passenger', 'katisha_admin'] }];
    const rules = buildRulesForUser('u', null, entries);
    expect((rules[0] as Record<string, unknown>)['conditions']).toBeUndefined();
  });
});

// ── buildAbility / buildAbilityFromRules ──────────────────────────────────────

describe('buildAbilityFromRules', () => {
  it('returns ability that can() correctly', () => {
    const rules = [{ action: 'read' as const, subject: 'User' as const }];
    const ability = buildAbilityFromRules(rules);
    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(false);
  });

  it('manage covers all CRUD actions', () => {
    const rules = [{ action: 'manage' as const, subject: 'User' as const }];
    const ability = buildAbilityFromRules(rules);
    expect(ability.can('create', 'User')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(true);
  });
});

describe('buildAbility (packed rules)', () => {
  it('round-trips pack/unpack and produces correct ability', () => {
    const rawRules = [{ action: 'read', subject: 'Org' }];
    const packed = packRules(rawRules);
    const ability = buildAbility(packed);
    expect(ability.can('read', 'Org')).toBe(true);
    expect(ability.can('write', 'Org')).toBe(false);
  });
});
