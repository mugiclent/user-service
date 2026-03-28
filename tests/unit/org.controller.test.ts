/**
 * Tests for src/api/org.controller.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockCreateOrg = vi.fn().mockResolvedValue({ id: 'org-1' });
const mockListOrgs = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
const mockGetMyOrg = vi.fn().mockResolvedValue({ id: 'org-1' });
const mockGetOrgById = vi.fn().mockResolvedValue({ id: 'org-1' });
const mockUpdateOrg = vi.fn().mockResolvedValue({ id: 'org-1' });
const mockApproveChildOrg = vi.fn().mockResolvedValue({ id: 'org-1' });

vi.mock('../../src/services/org.service.js', () => ({
  OrgService: {
    createOrg: mockCreateOrg,
    listOrgs: mockListOrgs,
    getMyOrg: mockGetMyOrg,
    getOrgById: mockGetOrgById,
    updateOrg: mockUpdateOrg,
    approveChildOrg: mockApproveChildOrg,
  },
}));

const mockGenerateOrgLogoPresignedUrl = vi.fn().mockResolvedValue({ uploadUrl: 'https://...', path: 'logo.png' });
vi.mock('../../src/services/media.service.js', () => ({
  MediaService: { generateOrgLogoPresignedUrl: mockGenerateOrgLogoPresignedUrl },
}));

const { OrgController } = await import('../../src/api/org.controller.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};

const next = vi.fn() as NextFunction;
const authUser = { id: 'user-1', org_id: 'org-1', user_type: 'staff', role_slugs: ['katisha_admin'], rules: [] };

beforeEach(() => vi.clearAllMocks());

// ── createOrg ─────────────────────────────────────────────────────────────────

describe('OrgController.createOrg', () => {
  it('returns 201 with created org', async () => {
    const req = {
      user: authUser,
      body: { name: 'Acme', org_type: 'company', contact_email: 'a@b.com', contact_phone: '+250788000001' },
    } as unknown as Request;
    const res = makeRes();
    await OrgController.createOrg(req, res, next);
    expect(mockCreateOrg).toHaveBeenCalledWith(authUser, req.body);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'org-1' });
  });

  it('calls next(err) on error', async () => {
    mockCreateOrg.mockRejectedValueOnce(new Error('dup'));
    const req = { user: authUser, body: {} } as unknown as Request;
    await OrgController.createOrg(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── listOrgs ──────────────────────────────────────────────────────────────────

describe('OrgController.listOrgs', () => {
  it('returns 200 with org list and parses query params', async () => {
    const req = { user: authUser, query: { page: '2', limit: '5', status: 'active', org_type: 'company' } } as unknown as Request;
    const res = makeRes();
    await OrgController.listOrgs(req, res, next);
    expect(mockListOrgs).toHaveBeenCalledWith(authUser, { page: 2, limit: 5, status: 'active', org_type: 'company' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('passes undefined for missing query params', async () => {
    const req = { user: authUser, query: {} } as unknown as Request;
    await OrgController.listOrgs(req, makeRes(), next);
    expect(mockListOrgs).toHaveBeenCalledWith(authUser, {
      page: undefined, limit: undefined, status: undefined, org_type: undefined,
    });
  });

  it('calls next(err) on error', async () => {
    mockListOrgs.mockRejectedValueOnce(new Error('db fail'));
    const req = { user: authUser, query: {} } as unknown as Request;
    await OrgController.listOrgs(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── getMyOrg ──────────────────────────────────────────────────────────────────

describe('OrgController.getMyOrg', () => {
  it('returns 200 with org data', async () => {
    const req = { user: authUser } as unknown as Request;
    const res = makeRes();
    await OrgController.getMyOrg(req, res, next);
    expect(mockGetMyOrg).toHaveBeenCalledWith(authUser);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(err) on error', async () => {
    mockGetMyOrg.mockRejectedValueOnce(new Error('not found'));
    const req = { user: authUser } as unknown as Request;
    await OrgController.getMyOrg(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── getOrgById ────────────────────────────────────────────────────────────────

describe('OrgController.getOrgById', () => {
  it('returns 200 with org data', async () => {
    const req = { user: authUser, params: { id: 'org-2' } } as unknown as Request;
    const res = makeRes();
    await OrgController.getOrgById(req, res, next);
    expect(mockGetOrgById).toHaveBeenCalledWith(authUser, 'org-2');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(err) on error', async () => {
    mockGetOrgById.mockRejectedValueOnce(new Error('forbidden'));
    const req = { user: authUser, params: { id: 'org-99' } } as unknown as Request;
    await OrgController.getOrgById(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── updateOrg ─────────────────────────────────────────────────────────────────

describe('OrgController.updateOrg', () => {
  it('returns 200 with updated org', async () => {
    const req = { user: authUser, params: { id: 'org-1' }, body: { name: 'New Name' } } as unknown as Request;
    const res = makeRes();
    await OrgController.updateOrg(req, res, next);
    expect(mockUpdateOrg).toHaveBeenCalledWith(authUser, 'org-1', { name: 'New Name' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(err) on error', async () => {
    mockUpdateOrg.mockRejectedValueOnce(new Error('forbidden'));
    const req = { user: authUser, params: { id: 'org-1' }, body: {} } as unknown as Request;
    await OrgController.updateOrg(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── getLogoPresignedUrl ───────────────────────────────────────────────────────

describe('OrgController.getLogoPresignedUrl', () => {
  it('uses params.id when present', async () => {
    const req = { user: authUser, params: { id: 'org-2' }, query: { content_type: 'image/png' } } as unknown as Request;
    const res = makeRes();
    await OrgController.getLogoPresignedUrl(req, res, next);
    expect(mockGenerateOrgLogoPresignedUrl).toHaveBeenCalledWith('org-2', 'image/png');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('falls back to user.org_id when params.id absent', async () => {
    const req = { user: authUser, params: {}, query: { content_type: 'image/jpeg' } } as unknown as Request;
    const res = makeRes();
    await OrgController.getLogoPresignedUrl(req, res, next);
    expect(mockGenerateOrgLogoPresignedUrl).toHaveBeenCalledWith('org-1', 'image/jpeg');
  });

  it('calls next with NO_ORG when neither params.id nor user.org_id present', async () => {
    const userNoOrg = { ...authUser, org_id: null };
    const req = { user: userNoOrg, params: {}, query: { content_type: 'image/jpeg' } } as unknown as Request;
    await OrgController.getLogoPresignedUrl(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_ORG', status: 400 }));
  });

  it('calls next with MISSING_CONTENT_TYPE when content_type absent', async () => {
    const req = { user: authUser, params: { id: 'org-1' }, query: {} } as unknown as Request;
    await OrgController.getLogoPresignedUrl(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_CONTENT_TYPE', status: 400 }));
  });

  it('calls next(err) when service throws', async () => {
    mockGenerateOrgLogoPresignedUrl.mockRejectedValueOnce(new Error('s3 fail'));
    const req = { user: authUser, params: { id: 'org-1' }, query: { content_type: 'image/png' } } as unknown as Request;
    await OrgController.getLogoPresignedUrl(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── approveChildOrg ───────────────────────────────────────────────────────────

describe('OrgController.approveChildOrg', () => {
  it('returns 200 with approved org', async () => {
    const req = { user: authUser, params: { id: 'org-2' } } as unknown as Request;
    const res = makeRes();
    await OrgController.approveChildOrg(req, res, next);
    expect(mockApproveChildOrg).toHaveBeenCalledWith(authUser, 'org-2');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(err) on error', async () => {
    mockApproveChildOrg.mockRejectedValueOnce(new Error('not pending'));
    const req = { user: authUser, params: { id: 'org-2' } } as unknown as Request;
    await OrgController.approveChildOrg(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
