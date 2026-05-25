import express, { Router } from 'express';
import { assertCompanyTenantAccess, requireAuth } from '../auth/middleware.ts';

/** Router de API de empresa: exige login y que el JWT coincida con :businessId. */
export function createCompanyRouter(): Router {
  const router = express.Router();
  router.use(requireAuth);
  router.use('/:businessId', assertCompanyTenantAccess);
  return router;
}
