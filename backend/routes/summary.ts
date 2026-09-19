import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import {
  buildResumenHoy,
  buildResumenActivity,
  buildResumenOrders,
  buildResumenClientBalances,
  buildResumenCash,
  buildResumenPayables,
} from '../domain/summary/resumen-rilo-service.ts';

const router = createCompanyRouter();

router.get('/:businessId/hoy', async (req: AuthenticatedRequest, res) => {
  try {
    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }
    const data = await buildResumenHoy(req.params.businessId);
    res.json(data);
  } catch (error) {
    console.error('resumen hoy:', error);
    res.status(500).json({ error: 'No se pudo cargar el resumen de hoy.' });
  }
});

router.get('/:businessId/activity', async (req: AuthenticatedRequest, res) => {
  try {
    if (req.auth?.scope !== 'company' || !req.auth.userId || !req.auth.user) {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }
    const limit = Number(req.query.limit) || 20;
    const data = await buildResumenActivity(
      req.params.businessId,
      { userId: req.auth.userId, rol: String(req.auth.user.rol ?? '') },
      limit
    );
    res.json(data);
  } catch (error) {
    console.error('resumen activity:', error);
    res.status(500).json({ error: 'No se pudo cargar la actividad.' });
  }
});

router.get('/:businessId/orders', async (req: AuthenticatedRequest, res) => {
  try {
    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }
    res.json(await buildResumenOrders(req.params.businessId));
  } catch (error) {
    console.error('resumen orders:', error);
    res.status(500).json({ error: 'No se pudieron cargar los pedidos.' });
  }
});

router.get('/:businessId/balances', async (req: AuthenticatedRequest, res) => {
  try {
    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }
    res.json(await buildResumenClientBalances(req.params.businessId));
  } catch (error) {
    console.error('resumen balances:', error);
    res.status(500).json({ error: 'No se pudieron cargar los saldos.' });
  }
});

router.get('/:businessId/cash', async (req: AuthenticatedRequest, res) => {
  try {
    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }
    res.json(await buildResumenCash(req.params.businessId));
  } catch (error) {
    console.error('resumen cash:', error);
    res.status(500).json({ error: 'No se pudo cargar la caja.' });
  }
});

router.get('/:businessId/payables', async (req: AuthenticatedRequest, res) => {
  try {
    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }
    res.json(await buildResumenPayables(req.params.businessId));
  } catch (error) {
    console.error('resumen payables:', error);
    res.status(500).json({ error: 'No se pudieron cargar los vencimientos.' });
  }
});

export default router;
