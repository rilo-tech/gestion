import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { requirePermission, requireBusinessModule } from '../auth/middleware.ts';
import { userHasPermission } from '../auth/constants.ts';
import type { UserRole } from '../auth/constants.ts';
import { buildBusinessReport, parseReportFilters } from '../utils/reports.ts';

const router = createCompanyRouter();
router.use(requireBusinessModule('reports'));

router.get(
  '/:businessId',
  requirePermission('reports.view'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const filters = parseReportFilters(req.query as Record<string, unknown>);
      const rol = req.auth!.user.rol as UserRole;
      const includeEconomics = userHasPermission(
        rol,
        req.auth!.user.permisos,
        'economics.view'
      );
      const includeCollaborators = userHasPermission(
        rol,
        req.auth!.user.permisos,
        'collaborators.access'
      );

      const report = await buildBusinessReport(req.params.businessId, filters, {
        includeEconomics,
        includeCollaborators,
      });

      res.json(report);
    } catch (error) {
      console.error('Error building report:', error);
      res.status(500).json({ error: 'No se pudo generar el reporte.' });
    }
  }
);

export default router;
