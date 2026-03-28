/**
 * Tests for src/services/media.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockIsAllowedContentType = vi.fn();
const mockIsAllowedDocContentType = vi.fn();
const mockGeneratePresignedPutUrl = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/put', path: 'key/file.jpg' });
const mockUserAvatarKey = vi.fn().mockReturnValue('avatars/user-1/avatar.jpg');
const mockOrgLogoKey = vi.fn().mockReturnValue('logos/org-1/logo.png');
const mockOrgDocumentKey = vi.fn().mockReturnValue('org-docs/org-1/cert.pdf');

vi.mock('../../src/utils/s3.js', () => ({
  isAllowedContentType: mockIsAllowedContentType,
  isAllowedDocContentType: mockIsAllowedDocContentType,
  generatePresignedPutUrl: mockGeneratePresignedPutUrl,
  userAvatarKey: mockUserAvatarKey,
  orgLogoKey: mockOrgLogoKey,
  orgDocumentKey: mockOrgDocumentKey,
}));

const { MediaService } = await import('../../src/services/media.service.js');

beforeEach(() => vi.clearAllMocks());

// ── generateUserAvatarPresignedUrl ─────────────────────────────────────────────

describe('MediaService.generateUserAvatarPresignedUrl', () => {
  it('throws UNSUPPORTED_MEDIA_TYPE for invalid content type', async () => {
    mockIsAllowedContentType.mockReturnValue(false);
    await expect(MediaService.generateUserAvatarPresignedUrl('user-1', 'application/pdf')).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE', status: 415,
    });
  });

  it('returns presigned URL for valid content type', async () => {
    mockIsAllowedContentType.mockReturnValue(true);
    const result = await MediaService.generateUserAvatarPresignedUrl('user-1', 'image/jpeg');
    expect(mockUserAvatarKey).toHaveBeenCalledWith('user-1', 'image/jpeg');
    expect(mockGeneratePresignedPutUrl).toHaveBeenCalledWith('avatars/user-1/avatar.jpg', 'image/jpeg');
    expect(result).toEqual({ uploadUrl: 'https://s3.example.com/put', path: 'key/file.jpg' });
  });
});

// ── generateOrgLogoPresignedUrl ───────────────────────────────────────────────

describe('MediaService.generateOrgLogoPresignedUrl', () => {
  it('throws UNSUPPORTED_MEDIA_TYPE for invalid content type', async () => {
    mockIsAllowedContentType.mockReturnValue(false);
    await expect(MediaService.generateOrgLogoPresignedUrl('org-1', 'text/plain')).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE', status: 415,
    });
  });

  it('returns presigned URL for valid content type', async () => {
    mockIsAllowedContentType.mockReturnValue(true);
    const result = await MediaService.generateOrgLogoPresignedUrl('org-1', 'image/png');
    expect(mockOrgLogoKey).toHaveBeenCalledWith('org-1', 'image/png');
    expect(mockGeneratePresignedPutUrl).toHaveBeenCalledWith('logos/org-1/logo.png', 'image/png');
    expect(result).toEqual({ uploadUrl: 'https://s3.example.com/put', path: 'key/file.jpg' });
  });
});

// ── generateOrgDocumentPresignedUrl ───────────────────────────────────────────

describe('MediaService.generateOrgDocumentPresignedUrl', () => {
  it('throws UNSUPPORTED_MEDIA_TYPE for invalid doc content type', async () => {
    mockIsAllowedDocContentType.mockReturnValue(false);
    await expect(MediaService.generateOrgDocumentPresignedUrl('org-1', 'business_certificate', 'image/gif')).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE', status: 415,
    });
  });

  it('returns presigned URL for valid doc content type', async () => {
    mockIsAllowedDocContentType.mockReturnValue(true);
    const result = await MediaService.generateOrgDocumentPresignedUrl('org-1', 'business_certificate', 'application/pdf');
    expect(mockOrgDocumentKey).toHaveBeenCalledWith('org-1', 'business_certificate', 'application/pdf');
    expect(mockGeneratePresignedPutUrl).toHaveBeenCalledWith('org-docs/org-1/cert.pdf', 'application/pdf');
    expect(result).toEqual({ uploadUrl: 'https://s3.example.com/put', path: 'key/file.jpg' });
  });

  it('passes doc_type through to orgDocumentKey', async () => {
    mockIsAllowedDocContentType.mockReturnValue(true);
    await MediaService.generateOrgDocumentPresignedUrl('org-1', 'rep_id', 'image/jpeg');
    expect(mockOrgDocumentKey).toHaveBeenCalledWith('org-1', 'rep_id', 'image/jpeg');
  });
});
