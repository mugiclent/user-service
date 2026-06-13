import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';

// Two buckets, each with its own credentials/identity:
//  - 'public'  → anonymously readable (logos, avatars); served straight off the CDN.
//  - 'private' → never anonymously readable (org documents); reached only via short-
//                lived presigned URLs.
export type BucketKind = 'public' | 'private';

const publicCredentials = { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey };
const privateCredentials = { accessKeyId: config.s3.privateAccessKey, secretAccessKey: config.s3.privateSecretKey };

const credentialsFor = (kind: BucketKind) => (kind === 'private' ? privateCredentials : publicCredentials);
const bucketFor = (kind: BucketKind): string => (kind === 'private' ? config.s3.privateBucket : config.s3.bucket);

const makeClient = (endpoint: string, kind: BucketKind): S3Client =>
  new S3Client({
    forcePathStyle: true,
    endpoint,
    credentials: credentialsFor(kind),
    region: config.s3.region,
    // AWS SDK v3 injects a default CRC32 integrity checksum. For presigned PUTs it
    // bakes the checksum of an EMPTY body into the URL, so the real upload fails with
    // BadDigest on S3-compatible stores (SeaweedFS). Only checksum when explicitly asked.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

// Signing clients use the PUBLIC endpoint so the browser can reach the presigned URL.
const signClient: Record<BucketKind, S3Client> = {
  public: makeClient(config.s3.endpoint, 'public'),
  private: makeClient(config.s3.endpoint, 'private'),
};

// Server-side clients use the INTERNAL endpoint (direct over the docker network).
const serverClient: Record<BucketKind, S3Client> = {
  public: makeClient(config.s3.internalEndpoint, 'public'),
  private: makeClient(config.s3.internalEndpoint, 'private'),
};

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
  kind: BucketKind = 'public',
): Promise<PresignedResult> => {
  const cmd = new PutObjectCommand({
    Bucket: bucketFor(kind),
    Key: path,
    ContentType: contentType,
  });

  const upload_url = await getSignedUrl(signClient[kind], cmd, {
    expiresIn: config.s3.presignedExpiresIn,
  });

  return { upload_url, path };
};

/**
 * Generate a short-lived presigned GET URL for reading a private object (e.g. an
 * org application document). The browser can fetch this directly; it expires.
 */
export const generatePresignedGetUrl = async (
  path: string,
  kind: BucketKind = 'private',
  expiresIn: number = config.s3.presignedExpiresIn,
): Promise<string> => {
  const cmd = new GetObjectCommand({ Bucket: bucketFor(kind), Key: path });
  return getSignedUrl(signClient[kind], cmd, { expiresIn });
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
export const deleteFromS3 = async (key: string, kind: BucketKind = 'public'): Promise<void> => {
  try {
    await serverClient[kind].send(new DeleteObjectCommand({
      Bucket: bucketFor(kind),
      Key: key,
    }));
  } catch (err) {
    console.error(`[s3] DELETE ${key} (${kind}) failed`, err);
  }
};
