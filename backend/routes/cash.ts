import express from 'express';
import { db } from '../firebase.ts';
import { formatOrderNumber } from '../utils/order-number.ts';
import {
  getCashOrigenNombre,
  normalizeCajaOrigenes,
  type CajaOrigen,
  type OrigenGrupo,
} from '../utils/cash-origenes.ts';
import {
  mapDeletionError,
  validateCashMovementDeletion,
} from '../utils/deletion-guards.ts';
import {
  getDefaultCashAmbitoId,
  normalizeCajaAmbitos,
  normalizeMovementAmbito,
  usesCashAmbitoSeparationFromCaja,
} from '../utils/caja-ambitos.ts';
import { createCompanyRouter } from './create-company-router.ts';

const router = createCompanyRouter();

async function loadCashOrigenes(businessId: string): Promise<CajaOrigen[]> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (!appDoc.exists) return normalizeCajaOrigenes([]);
  const caja = (appDoc.data()?.caja as Record<string, unknown>) ?? {};
  return normalizeCajaOrigenes(caja.origenes);
}

async function loadCajaConfig(businessId: string): Promise<Record<string, unknown>> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (!appDoc.exists) return {};
  return (appDoc.data()?.caja as Record<string, unknown>) ?? {};
}

async function usesCashAmbitoSeparation(businessId: string): Promise<boolean> {
  const caja = await loadCajaConfig(businessId);
  return usesCashAmbitoSeparationFromCaja(caja);
}

function normalizeAmbito(value: unknown, caja: Record<string, unknown>): string {
  return normalizeMovementAmbito(value, caja);
}

function isManualMovement(movement: Record<string, unknown>): boolean {
  if (movement.origenGrupo === 'manual') return true;

  const tipo = String(movement.origenTipo ?? '');
  if (tipo.startsWith('caja_manual')) return true;
  if (movement.pedidoId) return false;
  if (tipo.startsWith('pedido') || tipo === 'venta' || tipo.startsWith('venta')) return false;
  if (movement.origenGrupo === 'pedido' || movement.origenGrupo === 'venta') return false;

  return true;
}

function resolveOrigenGrupo(movement: Record<string, unknown>): OrigenGrupo {
  const stored = movement.origenGrupo;
  if (
    stored === 'pedido' ||
    stored === 'venta' ||
    stored === 'compra' ||
    stored === 'manual' ||
    stored === 'otro'
  ) {
    return stored;
  }

  const tipo = String(movement.origenTipo ?? '');
  if (tipo.startsWith('pedido') || movement.pedidoId) return 'pedido';
  if (tipo === 'compra' || tipo.startsWith('compra')) return 'compra';
  if (tipo === 'venta' || tipo.startsWith('venta')) return 'venta';
  if (tipo.startsWith('caja_manual')) return 'manual';
  if (isManualMovement(movement)) return 'manual';
  return 'otro';
}

function resolveOrigenLabel(
  movement: Record<string, unknown>,
  grupo: OrigenGrupo,
  origenes: CajaOrigen[]
): string {
  const base = getCashOrigenNombre(origenes, grupo);
  if (grupo === 'manual') {
    return movement.tipo === 'egreso' ? `${base} · egreso` : `${base} · ingreso`;
  }
  return base;
}

async function enrichMovements(
  businessId: string,
  movements: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const origenes = await loadCashOrigenes(businessId);
  const orderIds = new Set<string>();
  for (const movement of movements) {
    if (movement.pedidoId && !movement.numeroPedidoLabel) {
      orderIds.add(String(movement.pedidoId));
    }
  }

  const orderMap = new Map<string, { numeroPedido?: number; numeroPedidoLabel?: string }>();
  await Promise.all(
    [...orderIds].map(async (orderId) => {
      const snap = await db.collection(`negocios/${businessId}/pedidos`).doc(orderId).get();
      if (!snap.exists) return;
      const data = snap.data() ?? {};
      orderMap.set(orderId, {
        numeroPedido: data.numeroPedido,
        numeroPedidoLabel: data.numeroPedidoLabel,
      });
    })
  );

  return movements.map((movement) => {
    const pedidoId = movement.pedidoId ? String(movement.pedidoId) : null;
    const orderData = pedidoId ? orderMap.get(pedidoId) : undefined;
    const numeroPedido = (movement.numeroPedido as number | undefined) ?? orderData?.numeroPedido;
    const numeroPedidoLabel =
      (movement.numeroPedidoLabel as string | undefined) ??
      orderData?.numeroPedidoLabel ??
      (numeroPedido ? formatOrderNumber(numeroPedido) : null);
    const origenGrupo = resolveOrigenGrupo(movement);

    return {
      ...movement,
      origenGrupo,
      origenLabel: resolveOrigenLabel(movement, origenGrupo, origenes),
      numeroPedido: numeroPedido ?? null,
      numeroPedidoLabel: numeroPedidoLabel ?? null,
    };
  });
}

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db
      .collection(`negocios/${businessId}/movimientos_caja`)
      .orderBy('fecha', 'desc')
      .get();
    const movements = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const enriched = await enrichMovements(businessId, movements);
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching cash movements' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const tipo = req.body.tipo === 'egreso' ? 'egreso' : 'ingreso';
    const monto = Number(req.body.monto) || 0;
    const concepto = String(req.body.concepto ?? '').trim();
    const medio = String(req.body.medio ?? 'efectivo').trim() || 'efectivo';

    if (monto <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a cero.' });
    }

    if (!concepto) {
      return res.status(400).json({ error: 'Ingresá un concepto.' });
    }

    const caja = await loadCajaConfig(businessId);
    const ambito = normalizeAmbito(req.body.ambito, caja);

    const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
      tipo,
      monto,
      medio,
      concepto,
      ambito,
      fecha: new Date().toISOString(),
      origenTipo: tipo === 'egreso' ? 'caja_manual_egreso' : 'caja_manual_ingreso',
      origenGrupo: 'manual',
      origenId: null,
      pedidoId: null,
      numeroPedido: null,
      numeroPedidoLabel: null,
      clienteId: null,
      negocioId: businessId,
    });

    res.status(201).json({ id: docRef.id });
  } catch (error) {
    console.error('Error creating cash movement:', error);
    res.status(500).json({ error: 'Error creating cash movement' });
  }
});

router.put('/:businessId/:movementId', async (req, res) => {
  try {
    const { businessId, movementId } = req.params;
    const tipo = req.body.tipo === 'egreso' ? 'egreso' : 'ingreso';
    const monto = Number(req.body.monto) || 0;
    const concepto = String(req.body.concepto ?? '').trim();
    const medio = String(req.body.medio ?? 'efectivo').trim() || 'efectivo';

    if (monto <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a cero.' });
    }

    if (!concepto) {
      return res.status(400).json({ error: 'Ingresá un concepto.' });
    }

    const caja = await loadCajaConfig(businessId);
    const ambito = normalizeAmbito(req.body.ambito, caja);

    const movementRef = db
      .collection(`negocios/${businessId}/movimientos_caja`)
      .doc(movementId);
    const snap = await movementRef.get();

    if (!snap.exists) return res.status(404).json({ error: 'Movement not found' });

    const existing = snap.data();
    if (!isManualMovement(existing ?? {})) {
      return res.status(403).json({
        error: 'Solo se pueden editar movimientos manuales de caja.',
      });
    }

    await movementRef.update({
      tipo,
      monto,
      medio,
      concepto,
      ambito,
      origenTipo: tipo === 'egreso' ? 'caja_manual_egreso' : 'caja_manual_ingreso',
      origenGrupo: 'manual',
      updatedAt: new Date().toISOString(),
    });

    res.json({ id: movementId });
  } catch (error) {
    console.error('Error updating cash movement:', error);
    res.status(500).json({ error: 'Error updating cash movement' });
  }
});

router.delete('/:businessId/:movementId', async (req, res) => {
  try {
    const { businessId, movementId } = req.params;
    const movementRef = db
      .collection(`negocios/${businessId}/movimientos_caja`)
      .doc(movementId);
    const snap = await movementRef.get();

    if (!snap.exists) return res.status(404).json({ error: 'Movement not found' });

    const existing = snap.data() ?? {};

    await validateCashMovementDeletion(businessId, movementId, existing);

    await movementRef.delete();
    res.json({ id: movementId });
  } catch (error) {
    const mapped = mapDeletionError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    console.error('Error deleting cash movement:', error);
    res.status(500).json({ error: 'Error deleting cash movement' });
  }
});

export default router;
