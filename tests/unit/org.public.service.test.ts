/**
 * Unit tests for OrgService.listPublicOrgs (service layer only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockOrgFindMany = vi.fn().mockResolvedValue([]);
const mockOrgCount = vi.fn().mockResolvedValue(0);

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    org: { findMany: mockOrgFindMany, count: mockOrgCount, findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    role: { findFirst: vi.fn() },
    invitation: { create: vi.fn() },
  },
  Prisma: {},
}));

vi.mock('../../src/utils/publishers.js', () => ({
  publishAudit: vi.fn(),
  publishSms: vi.fn(),
  publishMail: vi.fn(),
  notifyUser: vi.fn(),
  publishOrgEvent: vi.fn(),
}));

vi.mock('../../src/loaders/redis.js', () => ({ getRedisClient: () => ({ set: vi.fn() }) }));
vi.mock('../../src/utils/s3.js', () => ({ deleteFromS3: vi.fn() }));
vi.mock('../../src/utils/crypto.js', () => ({ generateRawToken: vi.fn(() => 'tok'), hashToken: vi.fn((t: string) => `h:${t}`) }));
vi.mock('../../src/config/index.js', () => ({ config: { staffAppUrl: 'https://staff.katisha.com' } }));
vi.mock('../../src/utils/slugify.js', () => ({ slugify: vi.fn((n: string) => n.toLowerCase().replace(/\s/g, '-')) }));

const { OrgService } = await import('../../src/services/org.service.js');

beforeEach(() => vi.clearAllMocks());

// ── OrgService.listPublicOrgs ─────────────────────────────────────────────────

describe('OrgService.listPublicOrgs', () => {
  it('returns only active orgs', async () => {
    await OrgService.listPublicOrgs({});
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'active', deleted_at: null }),
      }),
    );
  });

  it('sensitive fields are never present in the response', async () => {
    mockOrgFindMany.mockResolvedValueOnce([
      { id: 'o1', name: 'Acme', slug: 'acme', org_type: 'company', logo_path: null },
    ]);
    mockOrgCount.mockResolvedValueOnce(1);
    const result = await OrgService.listPublicOrgs({});
    const org = result.data[0];
    expect(org).not.toHaveProperty('tin');
    expect(org).not.toHaveProperty('contact_phone');
    expect(org).not.toHaveProperty('contact_email');
    expect(org).not.toHaveProperty('contact_first_name');
    expect(org).not.toHaveProperty('contact_last_name');
    expect(org).not.toHaveProperty('address');
    expect(org).not.toHaveProperty('license_number');
    expect(org).not.toHaveProperty('approved_at');
    expect(org).not.toHaveProperty('child_orgs');
  });

  it('filters by q parameter case-insensitively', async () => {
    await OrgService.listPublicOrgs({ q: 'Acme' });
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: 'Acme', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('paginates correctly', async () => {
    await OrgService.listPublicOrgs({ page: 3, limit: 10 });
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it('defaults to page 1 limit 12', async () => {
    await OrgService.listPublicOrgs({});
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 12 }),
    );
  });

  it('caps limit at 100', async () => {
    await OrgService.listPublicOrgs({ limit: 999 });
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });
});
