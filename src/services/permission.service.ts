import { prisma } from '../models/index.js';

export const PermissionService = {
  /**
   * GET /permissions — return the full permission catalog from the DB.
   * Grouped by `group` for convenient frontend rendering.
   */
  async listPermissions(): Promise<Record<string, unknown>[]> {
    const perms = await prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { subject: 'asc' }, { action: 'asc' }],
    });

    return perms.map((p) => ({
      id: p.id,
      code: p.code,
      action: p.action,
      subject: p.subject,
      display_name: p.display_name,
      description: p.description,
      group: p.group,
    }));
  },
};
