import multer from 'multer';
import type { RequestHandler, Request } from 'express';
import { config } from '../config/index.js';
import { isAllowedMime } from '../utils/seaweedfs.js';
import { AppError } from '../utils/AppError.js';

/**
 * Memory storage — files land in req.file.buffer.
 * We push the buffer directly to SeaweedFS and never touch the local disk.
 */
const storage = multer.memoryStorage();

const fileFilter: multer.Options['fileFilter'] = (
  _req: Request,
  file,
  cb,
) => {
  if (!isAllowedMime(file.mimetype)) {
    return cb(new AppError('UNSUPPORTED_MEDIA_TYPE', 415));
  }
  cb(null, true);
};

/**
 * Single-image upload middleware.
 * Accepts: image/jpeg, image/png, image/webp, image/gif
 * Max size: SEAWEEDFS_MAX_FILE_SIZE_MB (default 5 MB)
 *
 * Usage:
 *   router.post('/avatar', authenticate, uploadImage('avatar'), controller.uploadAvatar)
 */
export const uploadImage = (fieldName: string): RequestHandler => {
  const instance = multer({
    storage,
    fileFilter,
    limits: { fileSize: config.seaweedfs.maxFileSizeBytes },
  });

  return instance.single(fieldName) as RequestHandler;
};
