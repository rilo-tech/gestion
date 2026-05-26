import express from 'express';
import { db } from '../firebase.ts';
import { normalizeMovementAmbito } from '../utils/caja-ambitos.ts';
import { requirePermission } from '../auth/middleware.ts';
import {
  createPayableObligation,
  deletePayableObligation,
  listPayableInstallments,
  listPayableObligations,
  parseCreatePayableInput,
  setPayableInstallmentPaid,
  setPayableObligationActive,
} from '../utils/payables.ts';
import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';

const router = createCompanyRouter();
router.use('/:businessId', requirePermission('payables.access'));

async function loadCajaConfig(businessId: string): Promise<Record<string, unknown>> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (!appDoc.exists) return {};
  return (appDoc.data()?.caja as Record<string, unknown>) ?? {};
}

function normalizeAmbito(value: unknown, caja: Record<string, unknown>): string {
  return normalizeMovementAmbito(value, caja);
}

router.get('/:businessId/installments', async (req, res) => {
  try {
    const installments = await listPayableInstallments(req.params.businessId);
    res.json(installments);
  } catch (error) {
    console.error('Error listing payables installments:', error);
    res.status(500).json({ error: 'No se pudieron cargar los vencimientos.' });
  }
});

router.get('/:businessId/obligations', async (req, res) => {
  try {
    const obligations = await listPayableObligations(req.params.businessId);
    res.json(obligations);
  } catch (error) {
    console.error('Error listing payables obligations:', error);
    res.status(500).json({ error: 'No se pudieron cargar las obligaciones.' });
  }
});

router.post('/:businessId/obligations', async (req, res) => {
  try {
    const input = parseCreatePayableInput(req.body);
    if (!input) {
      return res.status(400).json({
        error: 'Completá beneficiario, monto, fecha de vencimiento y cantidad de pagos.',
      });
    }

    const caja = await loadCajaConfig(req.params.businessId);
    input.ambito = normalizeAmbito(req.body.ambito, caja);

    const result = await createPayableObligation(req.params.businessId, input);
    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'payables',
      action: 'create',
      entityType: 'obligacion',
      entityId: result.obligation.id,
      entityLabel: input.beneficiario,
      summary: `Creó obligación a pagar: ${input.beneficiario} · $${input.monto}`,
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating payable obligation:', error);
    res.status(500).json({ error: 'No se pudo crear la cuenta a pagar.' });
  }
});

router.patch('/:businessId/installments/:cuotaId/paid', async (req, res) => {
  try {
    const paid = req.body.paid !== false;
    const cuota = await setPayableInstallmentPaid(
      req.params.businessId,
      req.params.cuotaId,
      paid
    );
    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'payables',
      action: paid ? 'payment' : 'update',
      entityType: 'cuota',
      entityId: req.params.cuotaId,
      summary: paid ? `Marcó cuota como pagada` : `Marcó cuota como pendiente`,
    });
    res.json(cuota);
  } catch (error) {
    if (error instanceof Error && error.message === 'CUOTA_NOT_FOUND') {
      return res.status(404).json({ error: 'Vencimiento no encontrado.' });
    }
    console.error('Error updating payable installment:', error);
    res.status(500).json({ error: 'No se pudo actualizar el pago.' });
  }
});

router.patch('/:businessId/obligations/:obligacionId/active', async (req, res) => {
  try {
    const activo = req.body.activo !== false;
    const obligation = await setPayableObligationActive(
      req.params.businessId,
      req.params.obligacionId,
      activo
    );
    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'payables',
      action: 'update',
      entityType: 'obligacion',
      entityId: req.params.obligacionId,
      entityLabel: obligation.beneficiario,
      summary: activo ? `Reactivó obligación ${obligation.beneficiario}` : `Desactivó obligación ${obligation.beneficiario}`,
    });
    res.json(obligation);
  } catch (error) {
    if (error instanceof Error && error.message === 'OBLIGATION_NOT_FOUND') {
      return res.status(404).json({ error: 'Obligación no encontrada.' });
    }
    console.error('Error updating payable obligation:', error);
    res.status(500).json({ error: 'No se pudo actualizar la obligación.' });
  }
});

router.delete('/:businessId/obligations/:obligacionId', async (req, res) => {
  try {
    await deletePayableObligation(req.params.businessId, req.params.obligacionId);
    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'payables',
      action: 'delete',
      entityType: 'obligacion',
      entityId: req.params.obligacionId,
      summary: `Eliminó una obligación a pagar`,
    });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'OBLIGATION_NOT_FOUND') {
      return res.status(404).json({ error: 'Obligación no encontrada.' });
    }
    console.error('Error deleting payable obligation:', error);
    res.status(500).json({ error: 'No se pudo eliminar la obligación.' });
  }
});

export default router;
