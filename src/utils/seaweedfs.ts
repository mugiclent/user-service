import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { config } from '../config/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageSubfolder = 'avatars' | 'logos';

export interface UploadResult {
  /** Absolute path on the Filer, e.g. /images/avatars/<uuid>.jpg */
  filerPath: string;
  /** Full public URL ready for <img src="..."> */
  publicUrl: string;
  /** UUID-based filename, e.g. <uuid>.jpg */
  filename: string;
}

// ---------------------------------------------------------------------------
// MIME → extension map (only allowed image types)
// ---------------------------------------------------------------------------

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const isAllowedMime = (mime: string): boolean => mime in ALLOWED_MIME;

const mimeToExt = (mime: string): string =>
  ALLOWED_MIME[mime] ?? extname(mime) ?? '.bin';

// ---------------------------------------------------------------------------
// Filer REST helpers
// ---------------------------------------------------------------------------

/**
 * Upload a buffer to SeaweedFS Filer.
 *
 * Uses PUT with the full path so the filename is deterministic (UUID-based).
 * SeaweedFS Filer PUT semantics: creates or overwrites the file at the given path.
 *
 * @param buffer   Raw file bytes
 * @param mimeType MIME type (e.g. "image/jpeg")
 * @param subfolder "avatars" | "logos"
 */
export const uploadToFiler = async (
  buffer: Buffer,
  mimeType: string,
  subfolder: ImageSubfolder,
): Promise<UploadResult> => {
  const ext = mimeToExt(mimeType);
  const filename = `${randomUUID()}${ext}`;
  const filerPath = `/images/${subfolder}/${filename}`;
  const url = `${config.seaweedfs.filerUrl}${filerPath}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: buffer,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SeaweedFS upload failed: ${response.status} ${body}`);
  }

  const publicUrl = `${config.seaweedfs.publicUrl}${filerPath}`;
  return { filerPath, publicUrl, filename };
};

/**
 * Delete a file from SeaweedFS Filer by its filer path.
 * Fire-and-forget safe — logs on failure but does not throw.
 */
export const deleteFromFiler = async (filerPath: string): Promise<void> => {
  const url = `${config.seaweedfs.filerUrl}${filerPath}`;
  try {
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      console.error(`[seaweedfs] DELETE ${filerPath} → ${response.status}`);
    }
  } catch (err) {
    console.error(`[seaweedfs] DELETE ${filerPath} failed`, err);
  }
};
