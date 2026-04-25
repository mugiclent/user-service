import { subject } from '@casl/ability';
import { prisma } from '../models/index.js';
import type { AuthenticatedUser } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { slugify } from '../utils/slugify.js';
import { publishAudit } from '../utils/publishers.js';
import {
  isValidPattern,
  maxScopeFromPatterns,
  compressPatterns,
  SCOPE_RANK,
  buildAbilityFromRules,
} from '../utils/ability.js';
import type { Subjects } from '../utils/ability.js';
import { getScopeFor } from '../utils/ability.js';
import { PERMISSIONS } from '../loaders/bootstrap.js';

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
  created_at: Date;
  role_grants: { id: string; pattern: string; is_managed: boolean; created_at: Date }[];
};

type RoleWithoutGrants = Omit<RoleWithGrants, 'role_grants'>;

const serializeRoleSummary = (role: RoleWithoutGrants): Record<string, unknown> => ({
  id: role.id,
  name: role.name,
  slug: role.slug,
  description: role.description,
  org_id: role.org_id,
  is_managed: role.is_managed,
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
    const platform = getScopeFor(ability, 'read', 'Role') === 'platform';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    if (platform) {
      // Platform admin sees everything including the passenger system role
      if (query.org_id) where['org_id'] = query.org_id;
    } else {
      // All other staff: global templates (org_id=null) + their own org's roles,
      // excluding the passenger system role
      where['OR'] = [{ org_id: null }, { org_id: requestingUser.org_id ?? null }];
      where['slug'] = { not: 'passenger' };
    }

    if (query.q) {
      if (!where['AND']) where['AND'] = [];
      where['AND'].push({ name: { contains: query.q, mode: 'insensitive' } });
    }

    const roles = await prisma.role.findMany({
      where,
      orderBy: [{ org_id: 'asc' }, { name: 'asc' }],
    });

    return { data: roles.map(serializeRoleSummary) };
  },

  // -------------------------------------------------------------------------
  // POST /roles
  // -------------------------------------------------------------------------

  async createRole(
    requestingUser: AuthenticatedUser,
    data: { name: string; slug?: string; description?: string; org_id?: string; patterns: string[] },
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const platform = getScopeFor(ability, 'manage', 'Role') === 'platform';

    if (!ability.can('manage', 'Role')) throw new AppError('FORBIDDEN', 403);

    // Validate every pattern against the catalog
    for (const pattern of data.patterns) {
      if (!isValidPattern(pattern, PERMISSIONS)) {
        throw new AppError('INVALID_GRANT_PATTERN', 422);
      }
    }

    // Privilege-escalation guard: org admins cannot create platform-scope grants
    if (!platform) {
      const maxScope = maxScopeFromPatterns(data.patterns);
      if (SCOPE_RANK[maxScope] >= SCOPE_RANK['platform']) {
        throw new AppError('GRANT_SCOPE_ESCALATION', 403);
      }
    }

    // Determine org_id for the new role
    const org_id = platform
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
    const platform = getScopeFor(ability, 'read', 'Role') === 'platform';

    const role = await prisma.role.findUnique({ where: { id: roleId }, ...withGrants });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);

    // The passenger role is an internal system role — only platform admins can inspect it
    if (!platform && role.slug === 'passenger') throw new AppError('FORBIDDEN', 403);

    // Global roles (org_id=null) are visible to everyone.
    // Org-scoped roles are visible only to members of that org (or platform admin).
    if (!platform && role.org_id !== null && role.org_id !== requestingUser.org_id) {
      throw new AppError('FORBIDDEN', 403);
    }

    return serializeRole(role);
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

    if (!ability.can('manage', 'Role')) throw new AppError('FORBIDDEN', 403);

    const role = await prisma.role.findUnique({ where: { id: roleId }, ...withGrants });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);
    if (role.slug === 'passenger') throw new AppError('MANAGED_ROLE_IMMUTABLE', 403);
    if (role.is_managed) throw new AppError('MANAGED_ROLE_IMMUTABLE', 403);

    // Platform admin can manage any role; org admin only their own org's roles
    // (the extra read Rule for global templates does NOT grant write access).
    if (!ability.can('manage', subject('Role', role) as unknown as Subjects)) {
      throw new AppError('FORBIDDEN', 403);
    }

    const updateData: { name?: string; description?: string } = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;

    const updated = await prisma.role.update({
      where: { id: roleId },
      data: updateData,
      ...withGrants,
    });

    setImmediate(() => publishAudit({
      actor_id: requestingUser.id,
      action: 'update',
      resource: 'Role',
      resource_id: roleId,
      delta: {
        ...(data.name !== undefined ? { name: { from: role.name, to: data.name } } : {}),
        ...(data.description !== undefined ? { description: { from: role.description, to: data.description } } : {}),
      },
    }));

    return serializeRole(updated);
  },

  // -------------------------------------------------------------------------
  // DELETE /roles/:id
  // -------------------------------------------------------------------------

  async deleteRole(requestingUser: AuthenticatedUser, roleId: string): Promise<void> {
    const ability = buildAbilityFromRules(requestingUser.rules);

    if (!ability.can('manage', 'Role')) throw new AppError('FORBIDDEN', 403);

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);
    if (role.slug === 'passenger') throw new AppError('MANAGED_ROLE_IMMUTABLE', 403);
    if (role.is_managed) throw new AppError('MANAGED_ROLE_IMMUTABLE', 403);

    if (!ability.can('manage', subject('Role', role) as unknown as Subjects)) {
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
    const platform = getScopeFor(ability, 'manage', 'Role') === 'platform';

    if (!ability.can('manage', 'Role')) throw new AppError('FORBIDDEN', 403);

    const role = await prisma.role.findUnique({ where: { id: roleId }, ...withGrants });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);
    if (role.slug === 'passenger') throw new AppError('MANAGED_ROLE_IMMUTABLE', 403);
    if (role.is_managed) throw new AppError('MANAGED_ROLE_IMMUTABLE', 403);

    if (!ability.can('manage', subject('Role', role) as unknown as Subjects)) {
      throw new AppError('FORBIDDEN', 403);
    }

    // Validate all patterns
    for (const pattern of patterns) {
      if (!isValidPattern(pattern, PERMISSIONS)) throw new AppError('INVALID_GRANT_PATTERN', 422);
    }

    // Escalation guard for org admins
    if (!platform) {
      const allPatterns = [...role.role_grants.map((g) => g.pattern), ...patterns];
      if (SCOPE_RANK[maxScopeFromPatterns(allPatterns)] >= SCOPE_RANK['platform']) {
        throw new AppError('GRANT_SCOPE_ESCALATION', 403);
      }
    }

    // Compute compressed pattern set after adding the new patterns, then diff
    const existingPatterns = role.role_grants.map((g) => g.pattern);
    const compressed = compressPatterns([...existingPatterns, ...patterns], PERMISSIONS);
    const existingSet = new Set(existingPatterns);
    const compressedSet = new Set(compressed);
    const toDelete = existingPatterns.filter((p) => !compressedSet.has(p));
    const toAdd = compressed.filter((p) => !existingSet.has(p));

    // No change — new pattern already subsumed by an existing wildcard
    if (toAdd.length === 0 && toDelete.length === 0) {
      return serializeRole(role);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (toDelete.length > 0) {
        await tx.roleGrant.deleteMany({ where: { role_id: roleId, pattern: { in: toDelete } } });
      }
      if (toAdd.length > 0) {
        await tx.roleGrant.createMany({ data: toAdd.map((p) => ({ role_id: roleId, pattern: p })) });
      }
      return tx.role.findUniqueOrThrow({ where: { id: roleId }, ...withGrants });
    });

    setImmediate(() => publishAudit({
      actor_id: requestingUser.id,
      action: 'update',
      resource: 'Role',
      resource_id: roleId,
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

    if (!ability.can('manage', 'Role')) throw new AppError('FORBIDDEN', 403);

    const grant = await prisma.roleGrant.findUnique({ where: { id: grantId } });
    if (!grant || grant.role_id !== roleId) throw new AppError('GRANT_NOT_FOUND', 404);
    if (grant.is_managed) throw new AppError('MANAGED_GRANT_IMMUTABLE', 403);

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);
    if (role.slug === 'passenger') throw new AppError('MANAGED_ROLE_IMMUTABLE', 403);
    if (!ability.can('manage', subject('Role', role) as unknown as Subjects)) {
      throw new AppError('FORBIDDEN', 403);
    }

    await prisma.roleGrant.delete({ where: { id: grantId } });

    setImmediate(() => publishAudit({
      actor_id: requestingUser.id,
      action: 'update',
      resource: 'Role',
      resource_id: roleId,
      delta: { grant_removed: { from: grant.pattern, to: null } },
    }));
  },
};
