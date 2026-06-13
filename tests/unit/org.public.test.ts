/**
 * Tests for GET /organizations/public via OrgController.
 * Service-layer tests are in org.public.service.test.ts.
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

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    org: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
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
vi.mock('../../src/config/index.js', () => ({ config: { appUrl: 'https://app.katisha.com' } }));

const { OrgController } = await import('../../src/api/org.controller.js');

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
    mockListPublicOrgs.mockResolvedValueOnce({ data, total: 1, page: 1, limit: 12 });
    const req = { query: {} } as unknown as Request;
    const res = makeRes();
    await OrgController.listPublicOrgs(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data, total: 1, page: 1, limit: 12 });
  });

  it('sets Cache-Control: public, max-age=60 header', async () => {
    mockListPublicOrgs.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 12 });
    const req = { query: {} } as unknown as Request;
    const res = makeRes();
    await OrgController.listPublicOrgs(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60');
  });

  it('passes q parameter to service', async () => {
    mockListPublicOrgs.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 12 });
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
