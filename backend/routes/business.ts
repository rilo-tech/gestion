import express from 'express';
import { toPublicBusinessInfo } from '../auth/business.ts';
import {
  assertCompanyTenantAccess,
  requireAuth,
  requireSupervisor,
  type AuthenticatedRequest,
} from '../auth/middleware.ts';

const router = express.Router();

router.get(
  '/:businessId',
  requireAuth,
  assertCompanyTenantAccess,
  requireSupervisor,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { businessId } = req.params;
      const business = await toPublicBusinessInfo(businessId);
      res.json(business);
    } catch (error) {
      console.error('Error fetching business info:', error);
      res.status(500).json({ error: 'No se pudo cargar la información de la empresa.' });
    }
  }
);

export default router;
