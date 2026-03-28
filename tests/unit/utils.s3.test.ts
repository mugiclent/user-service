/**
 * Tests for src/utils/s3.ts
 * Covers: isAllowedContentType, isAllowedDocContentType, key generators,
 *         generatePresignedPutUrl, deleteFromS3
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockSend = vi.fn().mockResolvedValue({});
const mockGetSignedUrl = vi.fn().mockResolvedValue('https://s3.test/bucket/key?sig=abc');

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  DeleteObjectCommand: vi.fn((params) => ({ ...params, _cmd: 'delete' })),
  PutObjectCommand: vi.fn((params) => ({ ...params, _cmd: 'put' })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('../../src/config/index.js', () => ({
  config: {
    s3: {
      accessKey: 'test-key',
      secretKey: 'test-secret',
      region: 'us-east-1',
      endpoint: 'http://s3-internal:8333',
      publicEndpoint: 'http://s3-public:8333',
      bucket: 'test-bucket',
      presignedExpiresIn: 300,
    },
  },
}));

const {
  isAllowedContentType,
  isAllowedDocContentType,
  userAvatarKey,
  orgLogoKey,
  orgDocumentKey,
  generatePresignedPutUrl,
  deleteFromS3,
} = await import('../../src/utils/s3.js');

beforeEach(() => vi.clearAllMocks());

// ── content-type validation ────────────────────────────────────────────────────

describe('isAllowedContentType', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])('allows %s', (ct) => {
    expect(isAllowedContentType(ct)).toBe(true);
  });

  it.each(['application/pdf', 'text/plain', 'application/octet-stream'])('rejects %s', (ct) => {
    expect(isAllowedContentType(ct)).toBe(false);
  });
});

describe('isAllowedDocContentType', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])('allows %s', (ct) => {
    expect(isAllowedDocContentType(ct)).toBe(true);
  });

  it('rejects text/plain', () => {
    expect(isAllowedDocContentType('text/plain')).toBe(false);
  });
});

// ── key generators ─────────────────────────────────────────────────────────────

describe('userAvatarKey', () => {
  it('returns avatars/<userId>/<uuid>.jpg for image/jpeg', () => {
    const key = userAvatarKey('user-1', 'image/jpeg');
    expect(key).toMatch(/^avatars\/user-1\/[0-9a-f-]{36}\.jpg$/);
  });

  it('returns .png for image/png', () => {
    expect(userAvatarKey('u', 'image/png')).toMatch(/\.png$/);
  });

  it('generates unique keys on each call', () => {
    expect(userAvatarKey('u', 'image/jpeg')).not.toBe(userAvatarKey('u', 'image/jpeg'));
  });
});

describe('orgLogoKey', () => {
  it('returns logos/<orgId>/<uuid>.jpg for image/jpeg', () => {
    const key = orgLogoKey('org-1', 'image/jpeg');
    expect(key).toMatch(/^logos\/org-1\/[0-9a-f-]{36}\.jpg$/);
  });
});

describe('orgDocumentKey', () => {
  it('returns org-docs/<orgId>/<docType>/<uuid>.pdf for application/pdf', () => {
    const key = orgDocumentKey('org-1', 'business_certificate', 'application/pdf');
    expect(key).toMatch(/^org-docs\/org-1\/business_certificate\/[0-9a-f-]{36}\.pdf$/);
  });

  it('uses .bin for unknown content types', () => {
    const key = orgDocumentKey('org-1', 'rep_id', 'application/octet-stream');
    expect(key).toMatch(/\.bin$/);
  });
});

// ── generatePresignedPutUrl ────────────────────────────────────────────────────

describe('generatePresignedPutUrl', () => {
  it('calls getSignedUrl and returns uploadUrl + path', async () => {
    const result = await generatePresignedPutUrl('avatars/u/file.jpg', 'image/jpeg');
    expect(result.uploadUrl).toBe('https://s3.test/bucket/key?sig=abc');
    expect(result.path).toBe('avatars/u/file.jpg');
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
  });
});

// ── deleteFromS3 ───────────────────────────────────────────────────────────────

describe('deleteFromS3', () => {
  it('sends a DeleteObjectCommand for the given key', async () => {
    await deleteFromS3('avatars/user-1/old.jpg');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('logs an error and does not throw when send fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('network error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(deleteFromS3('some/key')).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
