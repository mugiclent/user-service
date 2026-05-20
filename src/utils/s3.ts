import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';

const sharedCredentials = {
  accessKeyId: config.s3.accessKey,
  secretAccessKey: config.s3.secretKey,
};

// Used for presigned URLs — endpoint must be the public URL so clients can reach it
const publicClient = new S3Client({
  forcePathStyle: true,
  endpoint: config.s3.endpoint,
  credentials: sharedCredentials,
  region: config.s3.region,
});

// Used for server-side operations (delete) — talks to SeaweedFS directly over the internal network
const internalClient = new S3Client({
  forcePathStyle: true,
  endpoint: config.s3.internalEndpoint,
  credentials: sharedCredentials,
  region: config.s3.region,
});

// ---------------------------------------------------------------------------
// Content-type validation
// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

const ALLOWED_DOC_TYPES: Record<string, string> = {
  ...ALLOWED_IMAGE_TYPES,
  'application/pdf': 'pdf',
};

export const isAllowedContentType = (ct: string): boolean => ct in ALLOWED_IMAGE_TYPES;

export const isAllowedDocContentType = (ct: string): boolean => ct in ALLOWED_DOC_TYPES;

const extFor = (ct: string): string => ALLOWED_DOC_TYPES[ct] ?? 'bin';

// ---------------------------------------------------------------------------
// Presigned PUT URL
// ---------------------------------------------------------------------------

export interface PresignedResult {
  /** The URL the client should PUT the file to (expires in 5 min). */
  upload_url: string;
  /**
   * S3 object path — store this in the DB and send back via PATCH.
   * e.g. "avatars/user-id/uuid.jpg"
   * The frontend reconstructs the full URL as: CDN_URL + "/" + path
   */
  path: string;
}

export const generatePresignedPutUrl = async (
  path: string,
  contentType: string,
): Promise<PresignedResult> => {
  const cmd = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: path,
    ContentType: contentType,
  });

  const upload_url = await getSignedUrl(publicClient, cmd, {
    expiresIn: config.s3.presignedExpiresIn,
  });

  return { upload_url, path };
};

// ---------------------------------------------------------------------------
// Key generation helpers
// ---------------------------------------------------------------------------

export const userAvatarKey = (userId: string, contentType: string): string =>
  `avatars/${userId}/${randomUUID()}.${extFor(contentType)}`;

export const orgLogoKey = (orgId: string, contentType: string): string =>
  `logos/${orgId}/${randomUUID()}.${extFor(contentType)}`;

export const orgDocumentKey = (docType: string, contentType: string): string =>
  `org-docs/${docType}/${randomUUID()}.${extFor(contentType)}`;

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Fire-and-forget S3 delete. Logs on failure but does not throw. */
export const deleteFromS3 = async (key: string): Promise<void> => {
  try {
    await internalClient.send(new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    }));
  } catch (err) {
    console.error(`[s3] DELETE ${key} failed`, err);
  }
};
