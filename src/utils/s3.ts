import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';

// ---------------------------------------------------------------------------
// S3 clients
// Two clients are needed because of the "localhost trap":
// - internalClient uses S3_ENDPOINT (e.g. http://filer:8333 in Docker) for
//   server-side operations like deletes.
// - publicClient uses S3_PUBLIC_ENDPOINT (e.g. http://localhost:8333) for
//   generating presigned PUT URLs that the browser will call directly.
// ---------------------------------------------------------------------------

const clientOptions = {
  forcePathStyle: true, // required for SeaweedFS S3
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  region: config.s3.region,
};

const internalClient = new S3Client({
  ...clientOptions,
  endpoint: config.s3.endpoint,
});

const publicClient = new S3Client({
  ...clientOptions,
  endpoint: config.s3.publicEndpoint,
});

// ---------------------------------------------------------------------------
// Content-type validation
// ---------------------------------------------------------------------------

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

export const isAllowedContentType = (ct: string): boolean => ct in ALLOWED_CONTENT_TYPES;

const extFor = (ct: string): string => ALLOWED_CONTENT_TYPES[ct] ?? 'bin';

// ---------------------------------------------------------------------------
// Presigned PUT URL
// ---------------------------------------------------------------------------

export interface PresignedResult {
  /** The URL the client should PUT the file to (uses S3_PUBLIC_ENDPOINT, expires in 5 min). */
  uploadUrl: string;
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

  const uploadUrl = await getSignedUrl(publicClient, cmd, {
    expiresIn: config.s3.presignedExpiresIn,
  });

  return { uploadUrl, path };
};

// ---------------------------------------------------------------------------
// Key generation helpers
// ---------------------------------------------------------------------------

export const userAvatarKey = (userId: string, contentType: string): string =>
  `avatars/${userId}/${randomUUID()}.${extFor(contentType)}`;

export const orgLogoKey = (orgId: string, contentType: string): string =>
  `logos/${orgId}/${randomUUID()}.${extFor(contentType)}`;

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

