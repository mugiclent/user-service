import {
  generatePresignedPutUrl,
  userAvatarKey,
  orgLogoKey,
  isAllowedContentType,
  type PresignedResult,
} from '../utils/s3.js';
import { AppError } from '../utils/AppError.js';

// ---------------------------------------------------------------------------
// User avatar
// ---------------------------------------------------------------------------

/**
 * Generate a presigned PUT URL for a user's avatar.
 *
 * The client should:
 *   1. PUT the file to `uploadUrl` with the matching Content-Type header.
 *   2. PATCH /users/me with { avatar_path: path } to commit the path.
 */
export const MediaService = {
  async generateUserAvatarPresignedUrl(
    userId: string,
    contentType: string,
  ): Promise<PresignedResult> {
    if (!isAllowedContentType(contentType)) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 415);
    }
    const key = userAvatarKey(userId, contentType);
    return generatePresignedPutUrl(key, contentType);
  },

  // ---------------------------------------------------------------------------
  // Org logo
  // ---------------------------------------------------------------------------

  /**
   * Generate a presigned PUT URL for an org's logo.
   */
  async generateOrgLogoPresignedUrl(
    orgId: string,
    contentType: string,
  ): Promise<PresignedResult> {
    if (!isAllowedContentType(contentType)) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 415);
    }
    const key = orgLogoKey(orgId, contentType);
    return generatePresignedPutUrl(key, contentType);
  },
};
