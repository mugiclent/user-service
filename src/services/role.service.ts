import { prisma } from '../models/index.js';
import type { AuthenticatedUser } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { slugify } from '../utils/slugify.js';
import { publishAudit } from '../utils/publishers.js';
import {
  isValidPattern,
  canAssignGrants,
  compressPatterns,
  buildAbilityFromRules,
  getScopeFor,
} from '../utils/ability.js';
import { PERMISSIONS } from '../utils/catalog.js';
import { resolveEffective } from '../utils/overrides.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const withGrants = { include: { role_grants: { orderBy: { created_at: 'asc' as const } } } } as const;

type RoleWithGrants = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  org_id: string | null;
  is_managed: boolean;
  override_of: string | null;
  is_hidden: boolean;
  created_at: Date;
  role_grants: { id: string; pattern: string; is_managed: boolean; created_at: Date }[];
};

/**
 * Deep-copy a platform-default role (+ its grants) into an org-scoped fork, once.
 * Copy-on-write: the org edits the fork, never the shared default.
 */
const forkRole = async (orgId: string, def: RoleWithGrants): Promise<RoleWithGrants> => {
  const existing = await prisma.role.findFirst({ where: { org_id: orgId, override_of: def.id }, ...withGrants });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: { name: def.name, slug: def.slug, description: def.description, org_id: orgId, override_of: def.id, is_managed: false },
    });
    if (def.role_grants.length > 0) {
      await tx.roleGrant.createMany({
        data: def.role_grants.map((g) => ({ role_id: created.id, pattern: g.pattern, is_managed: false })),
      });
    }
    return tx.role.findUniqueOrThrow({ where: { id: created.id }, ...withGrants });
  });
};

/**
 * Resolve the concrete role an org may mutate: its own row, a platform admin's
 * direct target, or a fresh fork of a default (auto copy-on-write). Throws FORBIDDEN
 * if the role belongs to another org and the caller lacks platform scope.
 */
const ensureOrgRole = async (
  ability: ReturnType<typeof buildAbilityFromRules>,
  user: AuthenticatedUser,
  role: RoleWithGrants,
): Promise<RoleWithGrants> => {
  const canTargetAnyOrg = getScopeFor(ability, 'update', 'Role') === 'platform';
  if (canTargetAnyOrg) return role;                 // platform admin edits the row in place
  if (!user.org_id) throw new AppError('FORBIDDEN', 403);
  if (role.org_id === user.org_id) return role;     // org's own role
  if (role.org_id === null) return forkRole(user.org_id, role); // fork the default
  throw new AppError('FORBIDDEN', 403);             // another org's role
};

type RoleWithoutGrants = Omit<RoleWithGrants, 'role_grants'>;

const serializeRoleSummary = (role: RoleWithoutGrants): Record<string, unknown> => ({
  id: role.id,
  name: role.name,
  slug: role.slug,
  description: role.description,
  org_id: role.org_id,
  is_managed: role.is_managed,
  // Copy-on-write provenance: override_of is the platform default this row forks
  // (null for defaults / net-new org roles); is_customised lets the UI badge a
  // role the org has overridden.
  override_of: role.override_of,
  is_customised: role.override_of !== null,
  created_at: role.created_at,
});

const serializeRole = (role: RoleWithGrants): Record<string, unknown> => ({
  ...serializeRoleSummary(role),
  grants: role.role_grants.map((g) => ({
    id: g.id,
    pattern: g.pattern,
    is_managed: g.is_managed,
    created_at: g.created_at,
  })),
});


// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const RoleService = {
  // -------------------------------------------------------------------------
  // GET /roles
  // -------------------------------------------------------------------------

  async listRoles(
    requestingUser: AuthenticatedUser,
    query: { org_id?: string; q?: string },
  ): Promise<{ data: Record<string, unknown>[] }> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const canSeeAllOrgs = getScopeFor(ability, 'read', 'Role') === 'platform';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    if (canSeeAllOrgs) {
      if (query.org_id) where['org_id'] = query.org_id;
    } else {
      // Other staff see global templates (org_id=null) + their own org's roles.
      where['OR'] = [{ org_id: null }, { org_id: requestingUser.org_id ?? null }];
    }

    if (query.q) {
      where['AND'] = [{ name: { contains: query.q, mode: 'insensitive' } }];
    }

    const roles = await prisma.role.findMany({
      where,
      orderBy: [{ org_id: 'asc' }, { name: 'asc' }],
      ...withGrants,
    });

    // Copy-on-write: a non-platform viewer sees their org's fork in place of any
    // default it shadows (and tombstoned defaults disappear). Platform-scope readers
    // see the raw rows so they can manage defaults and inspect every org's forks.
    const visible = canSeeAllOrgs ? roles : resolveEffective(roles, requestingUser.org_id ?? null);

    // Annotate each role with whether the caller may assign it — this is what
    // drives the role-builder UI, and it is the SAME guard enforced on write.
    // (Org admins simply won't be able to assign e.g. passenger or platform-admin
    //  because they don't hold those grants — no slug special-casing needed.)
    return {
      data: visible.map((r) => ({
        ...serializeRoleSummary(r),
        can_assign: canAssignGrants(ability, r.role_grants.map((g) => g.pattern), PERMISSIONS),
      })),
    };
  },

  // -------------------------------------------------------------------------
  // POST /roles
  // -------------------------------------------------------------------------

  async createRole(
    requestingUser: AuthenticatedUser,
    data: { name: string; slug?: string; description?: string; org_id?: string; patterns: string[] },
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('create', 'Role')) throw new AppError('FORBIDDEN', 403);

    // Validate every pattern against the catalog
    for (const pattern of data.patterns) {
      if (!isValidPattern(pattern, PERMISSIONS)) {
        throw new AppError('INVALID_GRANT_PATTERN', 422);
      }
    }

    // Escalation guard: you can only grant power you already hold.
    if (!canAssignGrants(ability, data.patterns, PERMISSIONS)) {
      throw new AppError('GRANT_SCOPE_ESCALATION', 403);
    }

    // Only platform-scope role managers may target an arbitrary org.
    const canTargetAnyOrg = getScopeFor(ability, 'create', 'Role') === 'platform';
    const org_id = canTargetAnyOrg
      ? (data.org_id ?? null)
      : requestingUser.org_id!;

    const slug = data.slug ? data.slug : slugify(data.name);

    // Uniqueness check (Prisma unique constraint on slug+org_id)
    const existing = await prisma.role.findFirst({ where: { slug, org_id } });
    if (existing) throw new AppError('ROLE_ALREADY_EXISTS', 409);

    const compressed = compressPatterns(data.patterns, PERMISSIONS);

    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: { name: data.name, slug, description: data.description ?? null, org_id },
      });
      if (compressed.length > 0) {
        await tx.roleGrant.createMany({
          data: compressed.map((pattern) => ({ role_id: created.id, pattern })),
        });
      }
      return tx.role.findUniqueOrThrow({ where: { id: created.id }, ...withGrants });
    });

    publishAudit({ actor_id: requestingUser.id, action: 'create', resource: 'Role', resource_id: role.id });

    return serializeRole(role);
  },

  // -------------------------------------------------------------------------
  // GET /roles/:id
  // -------------------------------------------------------------------------

  async getRoleById(
    requestingUser: AuthenticatedUser,
    roleId: string,
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const canSeeAllOrgs = getScopeFor(ability, 'read', 'Role') === 'platform';

    const role = await prisma.role.findUnique({ where: { id: roleId }, ...withGrants });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);

    // Global templates (org_id=null) are visible to all staff; org-scoped roles
    // only to members of that org (or platform-scope readers).
    if (!canSeeAllOrgs && role.org_id !== null && role.org_id !== requestingUser.org_id) {
      throw new AppError('FORBIDDEN', 403);
    }

    return {
      ...serializeRole(role),
      can_assign: canAssignGrants(ability, role.role_grants.map((g) => g.pattern), PERMISSIONS),
    };
  },

  // -------------------------------------------------------------------------
  // PATCH /roles/:id — rename only (grants are managed separately)
  // -------------------------------------------------------------------------

  async updateRole(
    requestingUser: AuthenticatedUser,
    roleId: string,
    data: { name?: string; description?: string },
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('update', 'Role')) throw new AppError('FORBIDDEN', 403);

    const role = await prisma.role.findUnique({ where: { id: roleId }, ...withGrants });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);

    // Copy-on-write: an org editing a platform default forks an org-scoped copy
    // (ensureOrgRole), which also enforces object-level scope (own org / platform).
    const target = await ensureOrgRole(ability, requestingUser, role);

    const updateData: { name?: string; description?: string } = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;

    const updated = await prisma.role.update({
      where: { id: target.id },
      data: updateData,
      ...withGrants,
    });

    setImmediate(() => publishAudit({
      actor_id: requestingUser.id,
      action: 'update',
      resource: 'Role',
      resource_id: target.id,
      delta: {
        ...(data.name !== undefined ? { name: { from: target.name, to: data.name } } : {}),
        ...(data.description !== undefined ? { description: { from: target.description, to: data.description } } : {}),
      },
    }));

    return serializeRole(updated);
  },

  // -------------------------------------------------------------------------
  // DELETE /roles/:id
  // -------------------------------------------------------------------------

  async deleteRole(requestingUser: AuthenticatedUser, roleId: string): Promise<void> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('delete', 'Role')) throw new AppError('FORBIDDEN', 403);

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);

    const canTargetAnyOrg = getScopeFor(ability, 'delete', 'Role') === 'platform';

    // Org "deleting" a platform default → tombstone it for that org only (copy-on-
    // write); the shared default stays intact for every other org.
    if (!canTargetAnyOrg && role.org_id === null) {
      const orgId = requestingUser.org_id;
      if (!orgId) throw new AppError('FORBIDDEN', 403);
      const existing = await prisma.role.findFirst({ where: { org_id: orgId, override_of: role.id } });
      if (existing) {
        await prisma.role.update({ where: { id: existing.id }, data: { is_hidden: true } });
      } else {
        await prisma.role.create({
          data: { name: role.name, slug: role.slug, description: role.description, org_id: orgId, override_of: role.id, is_hidden: true, is_managed: false },
        });
      }
      publishAudit({ actor_id: requestingUser.id, action: 'delete', resource: 'Role', resource_id: role.id });
      return;
    }

    // Hard delete of an org's own role / a default as platform admin.
    if (!canTargetAnyOrg && role.org_id !== requestingUser.org_id) {
      throw new AppError('FORBIDDEN', 403);
    }

    // Block deletion if there are pending invitations referencing this role.
    const pendingInvitations = await prisma.invitationRole.count({
      where: { role_id: roleId, invitation: { accepted_at: null } },
    });
    if (pendingInvitations > 0) {
      throw new AppError('ROLE_HAS_PENDING_INVITATIONS', 409);
    }

    await prisma.role.delete({ where: { id: roleId } });

    publishAudit({ actor_id: requestingUser.id, action: 'delete', resource: 'Role', resource_id: roleId });
  },

  // -------------------------------------------------------------------------
  // POST /roles/:id/grants — add a grant pattern to a role
  // -------------------------------------------------------------------------

  async addGrant(
    requestingUser: AuthenticatedUser,
    roleId: string,
    patterns: string[],
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('update', 'Role')) throw new AppError('FORBIDDEN', 403);

    const role = await prisma.role.findUnique({ where: { id: roleId }, ...withGrants });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);

    // Copy-on-write: editing a default's grants forks an org-scoped copy first.
    const target = await ensureOrgRole(ability, requestingUser, role);

    // Validate all patterns
    for (const pattern of patterns) {
      if (!isValidPattern(pattern, PERMISSIONS)) throw new AppError('INVALID_GRANT_PATTERN', 422);
    }

    // Escalation guard: every new grant must be one the caller already holds.
    if (!canAssignGrants(ability, patterns, PERMISSIONS)) {
      throw new AppError('GRANT_SCOPE_ESCALATION', 403);
    }

    // Compute compressed pattern set after adding the new patterns, then diff
    const existingPatterns = target.role_grants.map((g) => g.pattern);
    const compressed = compressPatterns([...existingPatterns, ...patterns], PERMISSIONS);
    const existingSet = new Set(existingPatterns);
    const compressedSet = new Set(compressed);
    const toDelete = existingPatterns.filter((p) => !compressedSet.has(p));
    const toAdd = compressed.filter((p) => !existingSet.has(p));

    // No change — new pattern already subsumed by an existing wildcard
    if (toAdd.length === 0 && toDelete.length === 0) {
      return serializeRole(target);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (toDelete.length > 0) {
        await tx.roleGrant.deleteMany({ where: { role_id: target.id, pattern: { in: toDelete } } });
      }
      if (toAdd.length > 0) {
        await tx.roleGrant.createMany({ data: toAdd.map((p) => ({ role_id: target.id, pattern: p })) });
      }
      return tx.role.findUniqueOrThrow({ where: { id: target.id }, ...withGrants });
    });

    setImmediate(() => publishAudit({
      actor_id: requestingUser.id,
      action: 'update',
      resource: 'Role',
      resource_id: target.id,
      delta: {
        ...(toAdd.length > 0 ? { grants_added: toAdd } : {}),
        ...(toDelete.length > 0 ? { grants_consolidated: toDelete } : {}),
      },
    }));

    return serializeRole(updated);
  },

  // -------------------------------------------------------------------------
  // DELETE /roles/:id/grants/:grantId — remove a grant from a role
  // -------------------------------------------------------------------------

  async removeGrant(
    requestingUser: AuthenticatedUser,
    roleId: string,
    grantId: string,
  ): Promise<void> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('update', 'Role')) throw new AppError('FORBIDDEN', 403);

    const grant = await prisma.roleGrant.findUnique({ where: { id: grantId } });
    if (!grant || grant.role_id !== roleId) throw new AppError('GRANT_NOT_FOUND', 404);

    const role = await prisma.role.findUnique({ where: { id: roleId }, ...withGrants });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);

    // Copy-on-write: removing a grant from a default forks an org-scoped copy first.
    const target = await ensureOrgRole(ability, requestingUser, role);

    // On a fork the grant ids differ (they were copied), so match by pattern; on the
    // org's own role the grant id is stable.
    const targetGrant = target.id === role.id
      ? target.role_grants.find((g) => g.id === grantId)
      : target.role_grants.find((g) => g.pattern === grant.pattern);
    if (targetGrant) {
      await prisma.roleGrant.delete({ where: { id: targetGrant.id } });
    }

    setImmediate(() => publishAudit({
      actor_id: requestingUser.id,
      action: 'update',
      resource: 'Role',
      resource_id: target.id,
      delta: { grant_removed: { from: grant.pattern, to: null } },
    }));
  },
};
