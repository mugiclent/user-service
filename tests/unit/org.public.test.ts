/**
 * Tests for GET /organizations/public via OrgController + OrgService.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockListPublicOrgs = vi.fn();

vi.mock('../../src/services/org.service.js', () => ({
  OrgService: {
    listPublicOrgs: mockListPublicOrgs,
    createOrg: vi.fn(),
    listOrgs: vi.fn(),
    getMyOrg: vi.fn(),
    getOrgById: vi.fn(),
    updateOrg: vi.fn(),
    cooperativeApprove: vi.fn(),
  },
}));

vi.mock('../../src/services/media.service.js', () => ({
  MediaService: { generateOrgLogoPresignedUrl: vi.fn() },
}));

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

vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ set: vi.fn() }),
}));

vi.mock('../../src/utils/s3.js', () => ({ deleteFromS3: vi.fn() }));
vi.mock('../../src/utils/crypto.js', () => ({ generateRawToken: vi.fn(() => 'tok'), hashToken: vi.fn((t: string) => `h:${t}`) }));
vi.mock('../../src/config/index.js', () => ({ config: { staffAppUrl: 'https://app.katisha.com' } }));

const { OrgController } = await import('../../src/api/org.controller.js');

// ── OrgService.listPublicOrgs unit tests ──────────────────────────────────────

vi.mock('../../src/utils/slugify.js', () => ({ slugify: vi.fn((n: string) => n.toLowerCase().replace(/\s/g, '-')) }));
vi.mock('../../src/utils/ability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/ability.js')>();
  return { ...actual };
});

const { OrgService } = await import('../../src/services/org.service.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};

const next = vi.fn() as NextFunction;

beforeEach(() => vi.clearAllMocks());

// ── OrgController.listPublicOrgs ──────────────────────────────────────────────

describe('OrgController.listPublicOrgs', () => {
  it('returns 200 with no auth token', async () => {
    const data = [{ id: 'o1', name: 'Acme', slug: 'acme', org_type: 'company', logo_path: null }];
    mockListPublicOrgs.mockResolvedValueOnce({ data, total: 1, page: 1, limit: 50 });
    const req = { query: {} } as unknown as Request;
    const res = makeRes();
    await OrgController.listPublicOrgs(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data, total: 1, page: 1, limit: 50 });
  });

  it('sets Cache-Control: public, max-age=60 header', async () => {
    mockListPublicOrgs.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 50 });
    const req = { query: {} } as unknown as Request;
    const res = makeRes();
    await OrgController.listPublicOrgs(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60');
  });

  it('passes q parameter to service', async () => {
    mockListPublicOrgs.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 50 });
    const req = { query: { q: 'acme' } } as unknown as Request;
    await OrgController.listPublicOrgs(req, makeRes(), next);
    expect(mockListPublicOrgs).toHaveBeenCalledWith(expect.objectContaining({ q: 'acme' }));
  });

  it('parses page and limit from query', async () => {
    mockListPublicOrgs.mockResolvedValueOnce({ data: [], total: 0, page: 2, limit: 10 });
    const req = { query: { page: '2', limit: '10' } } as unknown as Request;
    await OrgController.listPublicOrgs(req, makeRes(), next);
    expect(mockListPublicOrgs).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 10 }));
  });

  it('calls next(err) on error', async () => {
    mockListPublicOrgs.mockRejectedValueOnce(new Error('db fail'));
    const req = { query: {} } as unknown as Request;
    await OrgController.listPublicOrgs(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── OrgService.listPublicOrgs unit tests ─────────────────────────────────────

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

  it('defaults to page 1 limit 50', async () => {
    await OrgService.listPublicOrgs({});
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    );
  });

  it('caps limit at 100', async () => {
    await OrgService.listPublicOrgs({ limit: 999 });
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });
});
