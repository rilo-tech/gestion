import express from 'express';
import { db } from '../firebase.ts';
import { formatOrderNumber } from '../utils/order-number.ts';

const router = express.Router();

type OrigenGrupo = 'pedido' | 'venta' | 'manual' | 'otro';

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
  if (stored === 'pedido' || stored === 'venta' || stored === 'manual' || stored === 'otro') {
    return stored;
  }

  const tipo = String(movement.origenTipo ?? '');
  if (tipo.startsWith('pedido') || movement.pedidoId) return 'pedido';
  if (tipo === 'venta' || tipo.startsWith('venta')) return 'venta';
  if (tipo.startsWith('caja_manual')) return 'manual';
  if (isManualMovement(movement)) return 'manual';
  return 'otro';
}

function resolveOrigenLabel(movement: Record<string, unknown>, grupo: OrigenGrupo): string {
  if (grupo === 'pedido') {
    const subtipo = String(movement.origenTipo ?? '');
    if (subtipo === 'pedido_senia') return 'Pedido · seña';
    if (subtipo === 'pedido_extra') return 'Pedido · extra';
    if (subtipo === 'pedido_cuota') return 'Pedido · cuota';
    if (subtipo === 'pedido_pago') return 'Pedido · pago';
    if (subtipo === 'pedido_cancelacion') return 'Pedido · anulación';
    return 'Pedido';
  }
  if (grupo === 'venta') {
    const subtipo = String(movement.origenTipo ?? '');
    if (subtipo === 'venta_pedido') return 'Venta · saldo pedido';
    if (subtipo === 'venta_mostrador') return 'Venta · mostrador';
    return 'Venta';
  }
  if (grupo === 'manual') {
    return movement.tipo === 'egreso' ? 'Manual · egreso' : 'Manual · ingreso';
  }
  return 'Otro';
}

async function enrichMovements(
  businessId: string,
  movements: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
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
      origenLabel: resolveOrigenLabel(movement, origenGrupo),
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

    const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
      tipo,
      monto,
      medio,
      concepto,
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

    const movementRef = db
      .collection(`negocios/${businessId}/movimientos_caja`)
      .doc(movementId);
    const snap = await movementRef.get();

    if (!snap.exists) return res.status(404).json({ error: 'Movement not found' });

    const existing = snap.data();
    if (!isManualMovement(existing?.origenTipo)) {
      return res.status(403).json({
        error: 'Solo se pueden editar movimientos manuales de caja.',
      });
    }

    await movementRef.update({
      tipo,
      monto,
      medio,
      concepto,
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

    const existing = snap.data();
    if (!isManualMovement(existing ?? {})) {
      return res.status(403).json({
        error: 'Solo se pueden eliminar movimientos manuales de caja.',
      });
    }

    await movementRef.delete();
    res.json({ id: movementId });
  } catch (error) {
    console.error('Error deleting cash movement:', error);
    res.status(500).json({ error: 'Error deleting cash movement' });
  }
});

export default router;
