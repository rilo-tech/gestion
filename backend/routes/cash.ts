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
import { createCompanyRouter } from './create-company-router.ts';
import { requireBusinessModule } from '../auth/middleware.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';
import { sortCashMovementsByRecency } from '../../shared/cash-movement-sort.ts';
import { schedulePayablesDataRepair } from '../utils/payables.ts';
import {
  buildCashMovementUpdate,
  getCashMonthlyIncomeSummary,
  getCashMovements,
  getCashSummary,
  getCashWalletSummaryForPeriod,
  isCashDomainError,
  isManualCashMovement,
  loadCajaConfig,
  registerCashMovement,
  type CashWalletPeriodKey,
} from '../domain/cash/index.ts';
import { loadFinanzasConfig } from '../utils/finance-config.ts';

const router = createCompanyRouter();
router.use(requireBusinessModule('caja'));
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

function isManualMovement(movement: Record<string, unknown>): boolean {
  return isManualCashMovement(movement);
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
  if (tipo === 'compra' || tipo.startsWith('compra') || movement.compraId) return 'compra';
  if (tipo === 'venta' || tipo.startsWith('venta') || movement.ventaId) return 'venta';
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
    schedulePayablesDataRepair(businessId);
    const summary = await getCashSummary(businessId, {
      month: req.query.mes,
      year: req.query.anio,
    });
    res.json(summary);
  } catch (error) {
    console.error('Error fetching cash summary:', error);
    res.status(500).json({ error: 'Error fetching cash summary' });
  }
});

/** Ingresos de caja por mes (últimos N) + promedio — no lista de pedidos. */
router.get('/:businessId/monthly-income', async (req, res) => {
  try {
    const { businessId } = req.params;
    const months = Number(req.query.months ?? req.query.meses ?? 6);
    const ambitoId = String(req.query.ambitoId ?? req.query.ambito ?? '').trim() || undefined;
    const summary = await getCashMonthlyIncomeSummary(businessId, { months, ambitoId });
    res.json(summary);
  } catch (error) {
    console.error('Error fetching cash monthly income:', error);
    res.status(500).json({ error: 'Error fetching cash monthly income' });
  }
});

/** Resumen tipo billetera: ingresos/egresos/balance agrupados por categoría. */
router.get('/:businessId/wallet-summary', async (req, res) => {
  try {
    const { businessId } = req.params;
    const rawPeriod = String(req.query.period ?? req.query.periodo ?? 'month').trim().toLowerCase();
    const period = (
      ['today', 'week', 'month', 'previous_month', 'custom'].includes(rawPeriod)
        ? rawPeriod
        : 'month'
    ) as CashWalletPeriodKey;
    const ambitoId = String(req.query.ambitoId ?? req.query.ambito ?? '').trim() || undefined;
    const from = String(req.query.from ?? req.query.desde ?? '').trim() || undefined;
    const to = String(req.query.to ?? req.query.hasta ?? '').trim() || undefined;

    const summary = await getCashWalletSummaryForPeriod(businessId, period, {
      from,
      to,
      ambitoId,
    });

    // Enriquecer labels de categoría desde config si el movimiento solo tiene id
    const finanzas = await loadFinanzasConfig(businessId);
    const catMap = new Map<string, string>();
    for (const c of finanzas.categoriasGasto) catMap.set(c.id, c.label);
    for (const c of finanzas.conceptosIngreso) catMap.set(c.id, c.label);

    const remap = (rows: typeof summary.ingresosByCategory) =>
      rows.map((row) => ({
        ...row,
        label: catMap.get(row.label) ?? row.label,
      }));

    const enriched = {
      ...summary,
      ingresosByCategory: remap(summary.ingresosByCategory),
      egresosByCategory: remap(summary.egresosByCategory),
    };
    res.json(enriched);
  } catch (error) {
    console.error('Error fetching cash wallet summary:', error);
    res.status(500).json({ error: 'Error fetching cash wallet summary' });
  }
});

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    schedulePayablesDataRepair(businessId);
    const paged = String(req.query.paged ?? '') === '1';
    if (paged) {
      const page = await getCashMovements(businessId, {
        paged: true,
        limit: Number(req.query.limit),
        cursor: String(req.query.cursor ?? '').trim() || undefined,
        month: req.query.mes,
        year: req.query.anio,
      });
      if (!page || Array.isArray(page)) {
        return res.status(500).json({ error: 'Error fetching cash movements' });
      }
      const enriched = sortCashMovementsByRecency(
        await enrichMovements(businessId, page.items as Record<string, unknown>[])
      );
      return res.json({ items: enriched, nextCursor: page.nextCursor, hasMore: page.hasMore });
    }

    const listed = await getCashMovements(businessId);
    const movements = Array.isArray(listed) ? listed : listed.items;
    const enriched = sortCashMovementsByRecency(
      await enrichMovements(businessId, movements as Record<string, unknown>[])
    );
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching cash movements' });
  }
});

function normalizeMovementDescripcion(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  return value || null;
}

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const authReq = req as AuthenticatedRequest;
    const created = await registerCashMovement({
      businessId,
      type: req.body.tipo === 'egreso' ? 'egreso' : 'ingreso',
      amount: Number(req.body.monto),
      concept: String(req.body.concepto ?? ''),
      scope: req.body.ambito,
      date: req.body.fecha,
      medio: String(req.body.medio ?? 'efectivo').trim() || 'efectivo',
      categoriaId: String(req.body.categoriaId ?? '').trim() || null,
      descripcion: normalizeMovementDescripcion(req.body.descripcion),
      source: 'web',
      actor: {
        type: 'web_user',
        userId: authReq.auth?.userId,
      },
    });

    await logActivityFromRequest(authReq, businessId, {
      module: 'cash',
      action: 'create',
      entityType: 'movimiento_caja',
      entityId: created.movementId,
      summary: `Registró ${created.type} manual de $${created.amount}: ${created.concept}`,
    });

    res.status(201).json({ id: created.movementId });
  } catch (error) {
    if (isCashDomainError(error)) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error('Error creating cash movement:', error);
    res.status(500).json({ error: 'Error creating cash movement' });
  }
});

router.put('/:businessId/:movementId', async (req, res) => {
  try {
    const { businessId, movementId } = req.params;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const movementRef = db
      .collection(`negocios/${businessId}/movimientos_caja`)
      .doc(movementId);
    const snap = await movementRef.get();

    if (!snap.exists) return res.status(404).json({ error: 'Movement not found' });

    const existing = (snap.data() ?? {}) as Record<string, unknown>;
    const caja = await loadCajaConfig(businessId);
    const patch = buildCashMovementUpdate(existing, body, caja);

    await movementRef.update(patch);

    const concepto = String(patch.concepto ?? existing.concepto ?? movementId);
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'cash',
      action: 'update',
      entityType: 'movimiento_caja',
      entityId: movementId,
      summary: `Editó movimiento de caja: ${concepto}`,
    });

    res.json({ id: movementId });
  } catch (error) {
    if (isCashDomainError(error)) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error('Error updating cash movement:', error);
    res.status(500).json({ error: 'No se pudo actualizar el movimiento.' });
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
