import type { Request, Response, NextFunction } from 'express';
import { OrgApplicationService } from '../services/org-application.service.js';
import { MediaService } from '../services/media.service.js';
import { AppError } from '../utils/AppError.js';

export const OrgApplicationController = {
  /**
   * GET /api/v1/organizations/apply/documents/presigned-url
   * ?doc_type=business_certificate&content_type=application/pdf
   *
   * Public — no authentication required.
   * Returns a presigned PUT URL for uploading an org application document.
   * The caller uploads directly to SeaweedFS, then includes the returned path
   * in POST /organizations/apply.
   *
   * Allowed content types:
   *   business_certificate → application/pdf
   *   rep_id               → application/pdf, image/jpeg, image/png, image/webp
   */
  async getDocumentPresignedUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { doc_type, content_type } = req.query as { doc_type?: string; content_type?: string };

      if (!doc_type || !content_type) {
        return next(new AppError('MISSING_QUERY_PARAMS', 400));
      }
      if (!['business_certificate', 'rep_id'].includes(doc_type)) {
        return next(new AppError('INVALID_DOC_TYPE', 400));
      }
      if (doc_type === 'business_certificate' && content_type !== 'application/pdf') {
        return next(new AppError('BUSINESS_CERTIFICATE_MUST_BE_PDF', 415));
      }

      // orgId is unknown at this stage — use a placeholder prefix; the actual path
      // is stored in OrgDocument after the org is created in POST /apply.
      // We use 'pending' as the org segment so uploads can proceed before org creation.
      const result = await MediaService.generateOrgDocumentPresignedUrl('pending', doc_type, content_type);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/organizations/apply
   *
   * Public — no authentication required.
   * Submit an org application with pre-uploaded document paths.
   * Sends an email OTP to contact_email for verification.
   */
  async apply(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await OrgApplicationService.apply(req.body as {
        name: string;
        org_type: string;
        contact_email: string;
        contact_phone: string;
        address?: string;
        tin?: string;
        license_number?: string;
        parent_org_id?: string;
        business_certificate_path: string;
        rep_id_path: string;
      });
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/organizations/verify-contact
   *
   * Public — no authentication required.
   * Verify the email OTP sent during org application.
   * Only on success are notifications sent to the applicant and Katisha admins.
   */
  async verifyContact(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { org_id, otp } = req.body as { org_id: string; otp: string };
      await OrgApplicationService.verifyContact(org_id, otp);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
};
