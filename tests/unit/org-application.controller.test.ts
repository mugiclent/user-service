/**
 * Tests for src/api/org-application.controller.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockApply = vi.fn();
const mockVerifyContact = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/org-application.service.js', () => ({
  OrgApplicationService: { apply: mockApply, verifyContact: mockVerifyContact },
}));

const mockGenerateOrgDocumentPresignedUrl = vi.fn().mockResolvedValue({ uploadUrl: 'https://...', path: 'doc.pdf' });
vi.mock('../../src/services/media.service.js', () => ({
  MediaService: { generateOrgDocumentPresignedUrl: mockGenerateOrgDocumentPresignedUrl },
}));

const { OrgApplicationController } = await import('../../src/api/org-application.controller.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};

const next = vi.fn() as NextFunction;

beforeEach(() => vi.clearAllMocks());

// ── getDocumentPresignedUrl ───────────────────────────────────────────────────

describe('OrgApplicationController.getDocumentPresignedUrl', () => {
  it('calls next with MISSING_QUERY_PARAMS when doc_type missing', async () => {
    const req = { query: { content_type: 'application/pdf' } } as unknown as Request;
    await OrgApplicationController.getDocumentPresignedUrl(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_QUERY_PARAMS', status: 400 }));
  });

  it('calls next with MISSING_QUERY_PARAMS when content_type missing', async () => {
    const req = { query: { doc_type: 'business_certificate' } } as unknown as Request;
    await OrgApplicationController.getDocumentPresignedUrl(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_QUERY_PARAMS', status: 400 }));
  });

  it('calls next with INVALID_DOC_TYPE for unknown doc_type', async () => {
    const req = { query: { doc_type: 'other_doc', content_type: 'application/pdf' } } as unknown as Request;
    await OrgApplicationController.getDocumentPresignedUrl(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_DOC_TYPE', status: 400 }));
  });

  it('calls next with BUSINESS_CERTIFICATE_MUST_BE_PDF when business_certificate is not PDF', async () => {
    const req = { query: { doc_type: 'business_certificate', content_type: 'image/jpeg' } } as unknown as Request;
    await OrgApplicationController.getDocumentPresignedUrl(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'BUSINESS_CERTIFICATE_MUST_BE_PDF', status: 415 }));
  });

  it('returns 200 with presigned URL for valid business_certificate (PDF)', async () => {
    const req = { query: { doc_type: 'business_certificate', content_type: 'application/pdf' } } as unknown as Request;
    const res = makeRes();
    await OrgApplicationController.getDocumentPresignedUrl(req, res, next);
    expect(mockGenerateOrgDocumentPresignedUrl).toHaveBeenCalledWith('pending', 'business_certificate', 'application/pdf');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ uploadUrl: 'https://...', path: 'doc.pdf' });
  });

  it('returns 200 with presigned URL for valid rep_id (JPEG)', async () => {
    const req = { query: { doc_type: 'rep_id', content_type: 'image/jpeg' } } as unknown as Request;
    const res = makeRes();
    await OrgApplicationController.getDocumentPresignedUrl(req, res, next);
    expect(mockGenerateOrgDocumentPresignedUrl).toHaveBeenCalledWith('pending', 'rep_id', 'image/jpeg');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(err) when service throws', async () => {
    mockGenerateOrgDocumentPresignedUrl.mockRejectedValueOnce(new Error('s3 fail'));
    const req = { query: { doc_type: 'rep_id', content_type: 'image/png' } } as unknown as Request;
    await OrgApplicationController.getDocumentPresignedUrl(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── apply ─────────────────────────────────────────────────────────────────────

describe('OrgApplicationController.apply', () => {
  const applyBody = {
    name: 'Acme',
    org_type: 'company',
    contact_email: 'ops@acme.com',
    contact_phone: '+250788000001',
    business_certificate_path: 'org-docs/pending/cert.pdf',
    rep_id_path: 'org-docs/pending/id.jpg',
  };

  it('returns 202 with application result', async () => {
    mockApply.mockResolvedValueOnce({ org_id: 'org-1', message: 'Received.' });
    const req = { body: applyBody } as unknown as Request;
    const res = makeRes();
    await OrgApplicationController.apply(req, res, next);
    expect(mockApply).toHaveBeenCalledWith(applyBody);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ org_id: 'org-1', message: 'Received.' });
  });

  it('calls next(err) on error', async () => {
    mockApply.mockRejectedValueOnce(new Error('dup'));
    const req = { body: applyBody } as unknown as Request;
    await OrgApplicationController.apply(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── verifyContact ─────────────────────────────────────────────────────────────

describe('OrgApplicationController.verifyContact', () => {
  it('returns 204 on success', async () => {
    const req = { body: { org_id: 'org-1', otp: '123456' } } as unknown as Request;
    const res = makeRes();
    await OrgApplicationController.verifyContact(req, res, next);
    expect(mockVerifyContact).toHaveBeenCalledWith('org-1', '123456');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('calls next(err) on error', async () => {
    mockVerifyContact.mockRejectedValueOnce(new Error('expired'));
    const req = { body: { org_id: 'org-1', otp: 'bad' } } as unknown as Request;
    await OrgApplicationController.verifyContact(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
