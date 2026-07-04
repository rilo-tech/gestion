import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { isActivityModule, listModuleActivity } from '../utils/activity-log.ts';
import type { UserRole } from '../auth/constants.ts';

const router = createCompanyRouter();

router.get('/:businessId', async (req: AuthenticatedRequest, res) => {
  try {
    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }

    const module = req.query.module;
    if (!isActivityModule(module)) {
      return res.status(400).json({ error: 'Módulo de actividad inválido.' });
    }

    const limit = Number(req.query.limit);
    const entityId =
      typeof req.query.entityId === 'string' ? req.query.entityId.trim() : '';
    const entries = await listModuleActivity(
      req.params.businessId,
      module,
      {
        userId: req.auth.userId,
        rol: req.auth.user.rol as UserRole,
      },
      {
        limit: Number.isFinite(limit) ? limit : undefined,
        entityId: entityId || undefined,
      }
    );

    res.json(entries);
  } catch (error) {
    console.error('Error listing activity:', error);
    res.status(500).json({ error: 'No se pudo cargar el historial de actividad.' });
  }
});

export default router;
