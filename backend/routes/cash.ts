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
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';

const router = createCompanyRouter();
const ORIGENES_CACHE_TTL_MS = 60_000;
const cashOrigenesCache = new Map<
  string,
  { data: CajaOrigen[]; expiresAt: number }
>();

async function loadCashOrigenes(businessId: string): Promise<CajaOrigen[]> {
  const cached = cashOrigenesCache.get(businessId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (!appDoc.exists) {
    const normalized = normalizeCajaOrigenes([]);
    cashOrigenesCache.set(businessId, {
      data: normalized,
      expiresAt: now + ORIGENES_CACHE_TTL_MS,
    });
    return normalized;
  }
  const caja = (appDoc.data()?.caja as Record<string, unknown>) ?? {};
  const normalized = normalizeCajaOrigenes(caja.origenes);
  cashOrigenesCache.set(businessId, {
    data: normalized,
    expiresAt: now + ORIGENES_CACHE_TTL_MS,
  });
  return normalized;
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

function isLinkedSystemMovement(movement: Record<string, unknown>): boolean {
  const tipo = String(movement.origenTipo ?? '');
  return (
    tipo === 'colaborador_pago' ||
    tipo === 'cuenta_pagar' ||
    tipo === 'tarjeta_resumen' ||
    tipo === 'compra'
  );
}

function isManualMovement(movement: Record<string, unknown>): boolean {
  if (isLinkedSystemMovement(movement)) return false;
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
  const tipo = String(movement.origenTipo ?? '');
  if (tipo === 'colaborador_pago') return 'Colaboradores · pago';
  if (tipo === 'cuenta_pagar') return 'Cuentas a pagar';
  if (tipo === 'tarjeta_resumen') return 'Tarjeta · resumen';

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
  if (orderIds.size > 0) {
    const orderRefs = [...orderIds].map((orderId) =>
      db.collection(`negocios/${businessId}/pedidos`).doc(orderId)
    );
    const CHUNK_SIZE = 200;
    for (let index = 0; index < orderRefs.length; index += CHUNK_SIZE) {
      const refsChunk = orderRefs.slice(index, index + CHUNK_SIZE);
      const snaps = await db.getAll(...refsChunk);
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const data = snap.data() ?? {};
        orderMap.set(snap.id, {
          numeroPedido: data.numeroPedido,
          numeroPedidoLabel: data.numeroPedidoLabel,
        });
      }
    }
  }

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

router.get('/:businessId/summary', async (req, res) => {
  try {
    const { businessId } = req.params;
    const caja = await loadCajaConfig(businessId);
    const ambitos = normalizeCajaAmbitos(caja);
    const ambitoTotals: Record<string, { ingreso: number; egreso: number }> = {};
    for (const ambito of ambitos) {
      ambitoTotals[ambito.id] = { ingreso: 0, egreso: 0 };
    }

    const snapshot = await db
      .collection(`negocios/${businessId}/movimientos_caja`)
      .get();

    let ingreso = 0;
    let egreso = 0;
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const monto = Number(data.monto) || 0;
      if (monto <= 0) continue;
      const tipo = data.tipo === 'egreso' ? 'egreso' : 'ingreso';
      const ambito = normalizeAmbito(data.ambito, caja);
      if (tipo === 'egreso') {
        egreso += monto;
        if (ambitoTotals[ambito]) ambitoTotals[ambito].egreso += monto;
      } else {
        ingreso += monto;
        if (ambitoTotals[ambito]) ambitoTotals[ambito].ingreso += monto;
      }
    }

    const ambitosSummary: Record<
      string,
      { ingreso: number; egreso: number; saldo: number }
    > = {};
    for (const [ambitoId, totals] of Object.entries(ambitoTotals)) {
      ambitosSummary[ambitoId] = {
        ingreso: totals.ingreso,
        egreso: totals.egreso,
        saldo: totals.ingreso - totals.egreso,
      };
    }

    res.json({
      ingreso,
      egreso,
      saldo: ingreso - egreso,
      ambitos: ambitosSummary,
    });
  } catch (error) {
    console.error('Error fetching cash summary:', error);
    res.status(500).json({ error: 'Error fetching cash summary' });
  }
});

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const paged = String(req.query.paged ?? '') === '1';
    if (paged) {
      const requestedLimit = Number(req.query.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(300, Math.max(20, Math.trunc(requestedLimit)))
        : 120;
      const cursor = String(req.query.cursor ?? '').trim();

      let query = db
        .collection(`negocios/${businessId}/movimientos_caja`)
        .orderBy('fecha', 'desc')
        .limit(limit + 1);

      if (cursor) {
        const cursorSnap = await db
          .collection(`negocios/${businessId}/movimientos_caja`)
          .doc(cursor)
          .get();
        if (cursorSnap.exists) {
          query = query.startAfter(cursorSnap);
        }
      }

      const snapshot = await query.get();
      const hasMore = snapshot.docs.length > limit;
      const pageDocs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;
      const movements = pageDocs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const enriched = await enrichMovements(businessId, movements);
      const nextCursor =
        hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1].id : null;
      return res.json({ items: enriched, nextCursor, hasMore });
    }

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

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'cash',
      action: 'create',
      entityType: 'movimiento_caja',
      entityId: docRef.id,
      summary: `Registró ${tipo} manual de $${monto}: ${concepto}`,
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

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'cash',
      action: 'update',
      entityType: 'movimiento_caja',
      entityId: movementId,
      summary: `Editó movimiento manual de caja: ${concepto}`,
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
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'cash',
      action: 'delete',
      entityType: 'movimiento_caja',
      entityId: movementId,
      summary: `Eliminó movimiento de caja: ${String(existing.concepto ?? movementId)}`,
    });
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
