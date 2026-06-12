import express from 'express';
import { db } from '../firebase.ts';
import { normalizeMovementAmbito } from '../utils/caja-ambitos.ts';
import { requirePermission } from '../auth/middleware.ts';
import {
  createPayableObligation,
  deletePayableObligation,
  getPayableObligation,
  getMensualInstallmentForMonth,
  invalidatePayablesReconcileCache,
  listPayableInstallments,
  listPayableObligations,
  schedulePayablesDataRepair,
  parseCreatePayableInput,
  setPayableInstallmentPaid,
  setPayableObligationActive,
  updatePayableObligation,
} from '../utils/payables.ts';
import {
  listCardStatementSummaries,
  payCardStatement,
} from '../utils/card-statements.ts';
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
    const mes = String(req.query.mes ?? '').trim().slice(0, 7);
    const scopeRaw = String(req.query.scope ?? '').trim().toLowerCase();
    const scope = scopeRaw === 'all' ? 'all' : mes ? 'month' : 'all';
    const estadoRaw = String(req.query.estado ?? '').trim().toLowerCase();
    const displayEstado =
      estadoRaw === 'pendiente' || estadoRaw === 'pagada' || estadoRaw === 'vencida'
        ? (estadoRaw as 'pendiente' | 'pagada' | 'vencida')
        : undefined;
    const ambito = String(req.query.ambito ?? '').trim() || undefined;
    const includeMonthSummary = req.query.includeMonthSummary !== '0';
    const result = await listPayableInstallments(req.params.businessId, {
      mes: /^\d{4}-\d{2}$/.test(mes) ? mes : undefined,
      scope,
      reconcile: req.query.reconcile === '1',
      displayEstado: scope === 'month' ? displayEstado : undefined,
      ambito,
      includeMonthSummary: scope === 'month' ? includeMonthSummary : false,
    });
    res.json(result);
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

router.get('/:businessId/obligations/:obligacionId', async (req, res) => {
  try {
    const obligation = await getPayableObligation(
      req.params.businessId,
      req.params.obligacionId
    );
    res.json(obligation);
  } catch (error) {
    if (error instanceof Error && error.message === 'OBLIGATION_NOT_FOUND') {
      return res.status(404).json({ error: 'Obligación no encontrada.' });
    }
    console.error('Error loading payable obligation:', error);
    res.status(500).json({ error: 'No se pudo cargar la obligación.' });
  }
});

router.get('/:businessId/obligations/:obligacionId/installment', async (req, res) => {
  const mes = String(req.query.mes ?? '').trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ error: 'Mes inválido.' });
  }

  try {
    const installment = await getMensualInstallmentForMonth(
      req.params.businessId,
      req.params.obligacionId,
      mes
    );
    res.json(installment);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'OBLIGATION_NOT_FOUND') {
        return res.status(404).json({ error: 'Obligación no encontrada.' });
      }
      if (error.message === 'NOT_MENSUAL') {
        return res.status(400).json({ error: 'Esta obligación no es un gasto fijo mensual.' });
      }
      if (error.message === 'NO_CUOTA_FOR_MONTH') {
        return res.status(404).json({
          error: `No hay vencimiento en ${mes} para este gasto fijo.`,
        });
      }
    }
    console.error('Error loading mensual installment:', error);
    res.status(500).json({ error: 'No se pudo cargar el vencimiento del mes.' });
  }
});

router.put('/:businessId/obligations/:obligacionId', async (req, res) => {
  try {
    const input = parseCreatePayableInput(req.body);
    if (!input) {
      return res.status(400).json({
        error: 'Completá beneficiario, monto, fecha de vencimiento y cantidad de pagos.',
      });
    }

    const caja = await loadCajaConfig(req.params.businessId);
    input.ambito = normalizeAmbito(req.body.ambito, caja);

    const result = await updatePayableObligation(
      req.params.businessId,
      req.params.obligacionId,
      input
    );
    invalidatePayablesReconcileCache(req.params.businessId);
    schedulePayablesDataRepair(req.params.businessId);
    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'payables',
      action: 'update',
      entityType: 'obligacion',
      entityId: req.params.obligacionId,
      entityLabel: input.beneficiario,
      summary: `Actualizó obligación a pagar: ${input.beneficiario} · $${input.monto}`,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'OBLIGATION_NOT_FOUND') {
        return res.status(404).json({ error: 'Obligación no encontrada.' });
      }
      if (error.message === 'OBLIGATION_NOT_EDITABLE') {
        return res.status(400).json({ error: 'Esta obligación no se puede editar desde aquí.' });
      }
      if (error.message === 'OBLIGATION_HAS_PAID_CUOTAS') {
        return res.status(400).json({
          error: 'No se puede modificar ni eliminar: hay cuotas ya pagadas.',
        });
      }
      if (error.message === 'MEDIO_PAGO_INVALID') {
        return res.status(400).json({ error: 'Medio de pago inválido o inactivo.' });
      }
      if (error.message === 'TARJETA_REQUIRED') {
        return res
          .status(400)
          .json({ error: 'Seleccioná la cuenta o tarjeta para este medio de pago.' });
      }
      if (error.message === 'TARJETA_NOT_FOUND') {
        return res.status(400).json({ error: 'Cuenta o tarjeta no encontrada.' });
      }
    }
    console.error('Error updating payable obligation:', error);
    res.status(500).json({ error: 'No se pudo actualizar la cuenta a pagar.' });
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
    schedulePayablesDataRepair(req.params.businessId);
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
    if (error instanceof Error) {
      if (error.message === 'MEDIO_PAGO_INVALID') {
        return res.status(400).json({ error: 'Medio de pago inválido o inactivo.' });
      }
      if (error.message === 'TARJETA_REQUIRED') {
        return res
          .status(400)
          .json({ error: 'Seleccioná la cuenta o tarjeta para este medio de pago.' });
      }
      if (error.message === 'TARJETA_NOT_FOUND') {
        return res.status(400).json({ error: 'Cuenta o tarjeta no encontrada.' });
      }
    }
    console.error('Error creating payable obligation:', error);
    res.status(500).json({ error: 'No se pudo crear la cuenta a pagar.' });
  }
});

router.patch('/:businessId/installments/:cuotaId/paid', async (req, res) => {
  try {
    const paid = req.body.paid !== false;
    const medioPagoId = req.body.medioPagoId
      ? String(req.body.medioPagoId).trim().toLowerCase()
      : undefined;
    const montoPagoRaw = Number(req.body.montoPago);
    const montoPago = Number.isFinite(montoPagoRaw) && montoPagoRaw > 0 ? montoPagoRaw : undefined;
    const concepto =
      req.body.concepto !== undefined ? String(req.body.concepto).trim() : undefined;
    const cuota = await setPayableInstallmentPaid(
      req.params.businessId,
      req.params.cuotaId,
      paid,
      paid ? { medioPagoId, montoPago, concepto } : undefined
    );
    invalidatePayablesReconcileCache(req.params.businessId);
    schedulePayablesDataRepair(req.params.businessId);
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
    if (error instanceof Error && error.message === 'MEDIO_PAGO_INVALID') {
      return res.status(400).json({ error: 'Medio de pago inválido para registrar el egreso.' });
    }
    if (error instanceof Error && error.message === 'CUOTA_MONTO_FIJO') {
      return res.status(400).json({
        error: 'Esta cuota debe pagarse por el monto completo. Los gastos mensuales recurrentes sí admiten otro importe.',
      });
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
    if (error instanceof Error) {
      if (error.message === 'OBLIGATION_NOT_FOUND') {
        return res.status(404).json({ error: 'Obligación no encontrada.' });
      }
      if (error.message === 'OBLIGATION_HAS_PAID_CUOTAS') {
        return res.status(400).json({
          error: 'No se puede eliminar: hay cuotas ya pagadas.',
        });
      }
    }
    console.error('Error deleting payable obligation:', error);
    res.status(500).json({ error: 'No se pudo eliminar la obligación.' });
  }
});

router.get('/:businessId/card-statements', async (req, res) => {
  try {
    const mes = String(req.query.mes ?? '').trim() || undefined;
    const summaries = await listCardStatementSummaries(req.params.businessId, mes);
    res.json(summaries);
  } catch (error) {
    console.error('Error listing card statements:', error);
    res.status(500).json({ error: 'No se pudieron cargar los resúmenes de tarjeta.' });
  }
});

router.post('/:businessId/card-statements/pay', async (req, res) => {
  try {
    const tarjetaId = String(req.body.tarjetaId ?? '').trim();
    const mes = String(req.body.mes ?? '').trim();
    const medioPagoId = String(req.body.medioPagoId ?? 'transferencia').trim().toLowerCase();
    const ambito = req.body.ambito ? String(req.body.ambito).trim().toLowerCase() : undefined;

    if (!tarjetaId || !mes) {
      return res.status(400).json({ error: 'Indicá tarjeta y mes del resumen.' });
    }

    const montoPagoRaw = Number(req.body.montoPago);
    const montoPago =
      Number.isFinite(montoPagoRaw) && montoPagoRaw > 0
        ? Math.round(montoPagoRaw * 100) / 100
        : undefined;
    const cuotaIds = Array.isArray(req.body.cuotaIds)
      ? req.body.cuotaIds.map((id: unknown) => String(id ?? '').trim()).filter(Boolean)
      : undefined;

    const result = await payCardStatement(req.params.businessId, {
      tarjetaId,
      mes,
      medioPagoId,
      ambito,
      notas: String(req.body.notas ?? '').trim() || undefined,
      montoPago,
      cuotaIds,
    });

    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'payables',
      action: 'payment',
      entityType: 'tarjeta_resumen',
      entityId: `${tarjetaId}_${mes}`,
      summary: `Pagó resumen ${tarjetaId} ${mes} · ${result.cuotasPagadas} cuota(s) · $${result.total}${result.saldoPendiente > 0 ? ` · saldo $${result.saldoPendiente}` : ''}`,
    });

    res.json(result);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'TARJETA_NOT_FOUND') {
        return res.status(400).json({ error: 'Tarjeta no encontrada.' });
      }
      if (error.message === 'NO_CUOTAS_PENDING') {
        return res.status(400).json({ error: 'No hay cuotas pendientes para esa tarjeta y mes.' });
      }
      if (error.message === 'MEDIO_PAGO_INVALID') {
        return res.status(400).json({ error: 'Medio de pago inválido para registrar el egreso.' });
      }
      if (error.message === 'MONTO_PAGO_INVALID') {
        return res.status(400).json({ error: 'Indicá un monto de pago mayor a cero.' });
      }
    }
    console.error('Error paying card statement:', error);
    res.status(500).json({ error: 'No se pudo registrar el pago del resumen.' });
  }
});

export default router;
