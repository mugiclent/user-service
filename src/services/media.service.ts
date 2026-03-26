import { prisma } from '../models/index.js';
import { uploadToFiler, deleteFromFiler } from '../utils/seaweedfs.js';
import type { ImageSubfolder } from '../utils/seaweedfs.js';
import { AppError } from '../utils/AppError.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type EntityType = 'user' | 'org';
type FieldName = 'avatar' | 'logo';

/** Find the current MediaAsset for an entity field (null if none). */
const findCurrent = (entityType: EntityType, entityId: string, fieldName: FieldName) =>
  prisma.mediaAsset.findUnique({
    where: {
      entity_type_entity_id_field_name: {
        entity_type: entityType,
        entity_id: entityId,
        field_name: fieldName,
      },
    },
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const MediaService = {
  /**
   * Upload (or replace) an image for a user's avatar.
   * Returns the new public URL.
   */
  async setUserAvatar(
    userId: string,
    uploadedBy: string,
    file: Express.Multer.File,
  ): Promise<string> {
    return replaceAsset({
      entityType: 'user',
      entityId: userId,
      fieldName: 'avatar',
      subfolder: 'avatars',
      uploadedBy,
      file,
      applyToEntity: (publicUrl) =>
        prisma.user.update({ where: { id: userId }, data: { avatar_url: publicUrl } }),
    });
  },

  /**
   * Remove a user's avatar — deletes from SeaweedFS and clears the field.
   */
  async deleteUserAvatar(userId: string): Promise<void> {
    return removeAsset({
      entityType: 'user',
      entityId: userId,
      fieldName: 'avatar',
      clearField: () =>
        prisma.user.update({ where: { id: userId }, data: { avatar_url: null } }),
    });
  },

  /**
   * Upload (or replace) an org logo.
   * Returns the new public URL.
   */
  async setOrgLogo(
    orgId: string,
    uploadedBy: string,
    file: Express.Multer.File,
  ): Promise<string> {
    return replaceAsset({
      entityType: 'org',
      entityId: orgId,
      fieldName: 'logo',
      subfolder: 'logos',
      uploadedBy,
      file,
      applyToEntity: (publicUrl) =>
        prisma.org.update({ where: { id: orgId }, data: { logo_url: publicUrl } }),
    });
  },

  /**
   * Remove an org logo — deletes from SeaweedFS and clears the field.
   */
  async deleteOrgLogo(orgId: string): Promise<void> {
    return removeAsset({
      entityType: 'org',
      entityId: orgId,
      fieldName: 'logo',
      clearField: () =>
        prisma.org.update({ where: { id: orgId }, data: { logo_url: null } }),
    });
  },
};

// ---------------------------------------------------------------------------
// Shared logic
// ---------------------------------------------------------------------------

interface ReplaceAssetOptions {
  entityType: EntityType;
  entityId: string;
  fieldName: FieldName;
  subfolder: ImageSubfolder;
  uploadedBy: string;
  file: Express.Multer.File;
  applyToEntity: (publicUrl: string) => Promise<unknown>;
}

async function replaceAsset(opts: ReplaceAssetOptions): Promise<string> {
  const { entityType, entityId, fieldName, subfolder, uploadedBy, file, applyToEntity } = opts;

  if (!file.buffer || file.size === 0) throw new AppError('INVALID_FILE', 400);

  // Upload new file to SeaweedFS first
  const { filerPath, publicUrl, filename } = await uploadToFiler(
    file.buffer,
    file.mimetype,
    subfolder,
  );

  // Persist: upsert MediaAsset + update entity field atomically
  const existing = await findCurrent(entityType, entityId, fieldName);

  await prisma.$transaction([
    prisma.mediaAsset.upsert({
      where: {
        entity_type_entity_id_field_name: {
          entity_type: entityType,
          entity_id: entityId,
          field_name: fieldName,
        },
      },
      create: {
        entity_type: entityType,
        entity_id: entityId,
        field_name: fieldName,
        filename,
        mime_type: file.mimetype,
        size_bytes: file.size,
        filer_path: filerPath,
        public_url: publicUrl,
        uploaded_by: uploadedBy,
      },
      update: {
        filename,
        mime_type: file.mimetype,
        size_bytes: file.size,
        filer_path: filerPath,
        public_url: publicUrl,
        uploaded_by: uploadedBy,
        created_at: new Date(),
      },
    }),
    applyToEntity(publicUrl) as ReturnType<typeof prisma.user.update>,
  ]);

  // Delete old file from SeaweedFS after DB is committed (fire-and-forget)
  if (existing) {
    deleteFromFiler(existing.filer_path);
  }

  return publicUrl;
}

interface RemoveAssetOptions {
  entityType: EntityType;
  entityId: string;
  fieldName: FieldName;
  clearField: () => Promise<unknown>;
}

async function removeAsset(opts: RemoveAssetOptions): Promise<void> {
  const { entityType, entityId, fieldName, clearField } = opts;

  const existing = await findCurrent(entityType, entityId, fieldName);
  if (!existing) return; // idempotent — nothing to remove

  await prisma.$transaction([
    prisma.mediaAsset.delete({
      where: {
        entity_type_entity_id_field_name: {
          entity_type: entityType,
          entity_id: entityId,
          field_name: fieldName,
        },
      },
    }),
    clearField() as ReturnType<typeof prisma.user.update>,
  ]);

  // Delete from SeaweedFS after DB commit
  deleteFromFiler(existing.filer_path);
}
