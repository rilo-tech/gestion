import express from 'express';
import { db } from '../firebase.ts';
import {
  mapDeletionError,
  validateOrderCancellation,
  validateStockMovementDeletion,
} from '../utils/deletion-guards.ts';
import {
  getStockOrigenNombre,
  normalizeStockOrigenes,
  type StockOrigenMovimiento,
} from '../utils/stock-movimientos.ts';
import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';
import {
  listStockReservations,
  listStockShortages,
  ensureStockReservationsSynced,
  reconcileOrderStockFromProductReservations,
} from '../utils/order-stock-reservations.ts';

const router = createCompanyRouter();

function normalizeProductNameKey(nombre: unknown): string {
  return String(nombre ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function findStockItemByName(
  businessId: string,
  nombre: string,
  excludeId?: string
): Promise<{ id: string; nombre?: string } | null> {
  const key = normalizeProductNameKey(nombre);
  if (!key) return null;

  const snapshot = await db.collection(`negocios/${businessId}/stock`).get();
  for (const doc of snapshot.docs) {
    if (excludeId && doc.id === excludeId) continue;
    const data = doc.data();
    if (normalizeProductNameKey(data.nombre) === key) {
      return { id: doc.id, nombre: String(data.nombre ?? '') };
    }
  }

  return null;
}

async function loadStockOrigenes(businessId: string): Promise<StockOrigenMovimiento[]> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (!appDoc.exists) return normalizeStockOrigenes([]);
  const stock = (appDoc.data()?.stock as Record<string, unknown>) ?? {};
  return normalizeStockOrigenes(stock.origenes);
}

// Get stock items
router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db.collection(`negocios/${businessId}/stock`).get();
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching stock' });
  }
});

// Create stock item
router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const itemData = req.body;
    const stockActual = Number(itemData.stockActual) || 0;
    const nombre = String(itemData.nombre ?? '').trim();

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre del producto es obligatorio.' });
    }

    const duplicate = await findStockItemByName(businessId, nombre);
    if (duplicate) {
      return res.status(409).json({
        error: `Ya existe un producto con el nombre «${duplicate.nombre ?? nombre}».`,
      });
    }

    const docRef = await db.collection(`negocios/${businessId}/stock`).add({
      ...itemData,
      stockActual,
      stockMinimo: Number(itemData.stockMinimo) || 0,
      stockReservado: Number(itemData.stockReservado) || 0,
      controlaStock: itemData.controlaStock !== false,
      costo: Number(itemData.costo) || 0,
      precioSugerido: Number(itemData.precioSugerido) || 0,
      negocioId: businessId,
      createdAt: new Date().toISOString(),
    });

    if (stockActual > 0) {
      await db.collection(`negocios/${businessId}/movimientos_stock`).add({
        productoId: docRef.id,
        tipo: 'entrada',
        cantidad: stockActual,
        fecha: new Date().toISOString(),
        motivo: 'Carga inicial',
        origenGrupo: 'carga_inicial',
        origenTipo: 'carga_inicial',
        usuarioId: 'admin',
        negocioId: businessId,
      });
    }

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'stock',
      action: 'create',
      entityType: 'producto',
      entityId: docRef.id,
      entityLabel: String(itemData.nombre ?? ''),
      summary: `Creó el producto ${String(itemData.nombre ?? docRef.id)}`,
    });

    res.status(201).json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: 'Error creating stock item' });
  }
});

// Search stock items (does not return full catalog)
router.get('/:businessId/search', async (req, res) => {
  try {
    const { businessId } = req.params;
    const query = String(req.query.q ?? '').trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    if (query.length < 2) {
      return res.json([]);
    }

    const snapshot = await db.collection(`negocios/${businessId}/stock`).get();
    const items = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => String(item.nombre ?? '').toLowerCase().includes(query))
      .slice(0, limit);

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Error searching stock' });
  }
});

type StockOrigenGrupo = 'compra' | 'pedido' | 'venta' | 'ajuste' | 'carga_inicial' | 'otro';

function resolveOrigenGrupo(movement: Record<string, unknown>): StockOrigenGrupo {
  const stored = movement.origenGrupo;
  if (
    stored === 'compra' ||
    stored === 'pedido' ||
    stored === 'venta' ||
    stored === 'ajuste' ||
    stored === 'carga_inicial' ||
    stored === 'otro'
  ) {
    return stored;
  }

  const tipo = String(movement.origenTipo ?? '');
  if (tipo === 'compra' || movement.compraId) return 'compra';
  if (tipo.startsWith('pedido')) return 'pedido';
  if (tipo === 'venta' || tipo.startsWith('venta')) return 'venta';
  if (tipo === 'carga_inicial') return 'carga_inicial';
  if (tipo.startsWith('ajuste') || tipo === 'ajuste_manual') return 'ajuste';
  return 'otro';
}

function resolveOrigenLabel(
  grupo: StockOrigenGrupo,
  movement: Record<string, unknown>,
  origenes: StockOrigenMovimiento[]
): string {
  const base = getStockOrigenNombre(origenes, grupo);
  if (grupo === 'pedido') {
    const subtipo = String(movement.origenTipo ?? '');
    if (subtipo === 'pedido_reserva') return `${base} · reserva`;
    if (subtipo === 'pedido_liberacion_reserva') return `${base} · libera reserva`;
    if (subtipo === 'pedido_produccion') return `${base} · producción`;
    if (subtipo === 'pedido_cancelado') return `${base} · cancelación`;
    if (subtipo === 'pedido_eliminado') return `${base} · restauración`;
  }
  return base;
}

async function enrichStockMovements(
  businessId: string,
  movements: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const origenes = await loadStockOrigenes(businessId);
  const productIds = new Set<string>();
  const orderIds = new Set<string>();

  for (const movement of movements) {
    if (movement.productoId) productIds.add(String(movement.productoId));
    const origenTipo = String(movement.origenTipo ?? '');
    if (origenTipo.startsWith('pedido') && movement.origenId) {
      orderIds.add(String(movement.origenId));
    }
  }

  const productMap = new Map<string, { nombre?: string }>();
  await Promise.all(
    [...productIds].map(async (productId) => {
      const snap = await db.collection(`negocios/${businessId}/stock`).doc(productId).get();
      if (!snap.exists) return;
      productMap.set(productId, { nombre: snap.data()?.nombre });
    })
  );

  const orderMap = new Map<
    string,
    { numeroPedidoLabel?: string; numeroPedido?: number; clienteId?: string; clienteNombre?: string }
  >();
  const clientIds = new Set<string>();
  await Promise.all(
    [...orderIds].map(async (orderId) => {
      const snap = await db.collection(`negocios/${businessId}/pedidos`).doc(orderId).get();
      if (!snap.exists) return;
      const data = snap.data() ?? {};
      const clienteId = String(data.clienteId ?? '').trim();
      if (clienteId) clientIds.add(clienteId);
      orderMap.set(orderId, {
        numeroPedido: data.numeroPedido,
        numeroPedidoLabel: data.numeroPedidoLabel,
        clienteId: clienteId || undefined,
      });
    })
  );

  const clientMap = new Map<string, string>();
  await Promise.all(
    [...clientIds].map(async (clienteId) => {
      const snap = await db.collection(`negocios/${businessId}/clientes`).doc(clienteId).get();
      clientMap.set(clienteId, String(snap.data()?.nombre ?? '').trim());
    })
  );

  for (const [orderId, orderData] of orderMap.entries()) {
    if (!orderData.clienteId) continue;
    orderData.clienteNombre = clientMap.get(orderData.clienteId) || undefined;
  }

  return movements.map((movement) => {
    const productoId = movement.productoId ? String(movement.productoId) : null;
    const productData = productoId ? productMap.get(productoId) : undefined;
    const origenGrupo = resolveOrigenGrupo(movement);
    const origenTipo = String(movement.origenTipo ?? '');
    const pedidoId =
      origenTipo.startsWith('pedido') && movement.origenId ? String(movement.origenId) : null;
    const orderData = pedidoId ? orderMap.get(pedidoId) : undefined;
    const storedClientName = String(movement.clienteNombre ?? '').trim();
    const clienteNombre =
      storedClientName ||
      orderData?.clienteNombre ||
      (movement.clienteId ? clientMap.get(String(movement.clienteId)) : undefined) ||
      null;

    return {
      ...movement,
      productoNombre: productData?.nombre ?? null,
      origenGrupo,
      origenLabel: resolveOrigenLabel(origenGrupo, movement, origenes),
      pedidoId,
      numeroPedidoLabel:
        orderData?.numeroPedidoLabel ??
        (orderData?.numeroPedido
          ? String(orderData.numeroPedido).padStart(5, '0')
          : null),
      clienteId: movement.clienteId ?? orderData?.clienteId ?? null,
      clienteNombre,
      compraId: movement.compraId ?? (origenTipo === 'compra' ? movement.origenId : null),
    };
  });
}

router.get('/:businessId/faltantes', async (req, res) => {
  try {
    const { businessId } = req.params;
    const data = await listStockShortages(businessId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching stock shortages' });
  }
});

router.get('/:businessId/reservations', async (req, res) => {
  try {
    const { businessId } = req.params;
    await ensureStockReservationsSynced(businessId);
    const stockItemId = String(req.query.stockItemId ?? '').trim() || undefined;
    const data = await listStockReservations(businessId, stockItemId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching stock reservations' });
  }
});

router.post('/:businessId/reconcile-reservations', async (req, res) => {
  try {
    const { businessId } = req.params;
    const summary = await reconcileOrderStockFromProductReservations(businessId);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Error reconciling stock reservations' });
  }
});

router.get('/:businessId/movements', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db
      .collection(`negocios/${businessId}/movimientos_stock`)
      .orderBy('fecha', 'desc')
      .get();
    const movements = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const enriched = await enrichStockMovements(businessId, movements);
    res.json(enriched);
  } catch (error) {
    console.error('Error fetching stock movements:', error);
    res.status(500).json({ error: 'Error fetching stock movements' });
  }
});

router.delete('/:businessId/movements/:movementId', async (req, res) => {
  try {
    const { businessId, movementId } = req.params;
    const movementRef = db
      .collection(`negocios/${businessId}/movimientos_stock`)
      .doc(movementId);
    const snap = await movementRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Movement not found' });

    const movement = snap.data() ?? {};
    await validateStockMovementDeletion(businessId, movement);

    const productoId = String(movement.productoId ?? '');
    const cantidad = Number(movement.cantidad) || 0;
    const tipo = movement.tipo === 'salida' ? 'salida' : 'entrada';

    if (productoId && cantidad > 0) {
      const itemRef = db.collection(`negocios/${businessId}/stock`).doc(productoId);
      const itemSnap = await itemRef.get();
      if (itemSnap.exists) {
        const currentStock = Number(itemSnap.data()?.stockActual) || 0;
        const delta = tipo === 'entrada' ? -cantidad : cantidad;
        await itemRef.update({
          stockActual: currentStock + delta,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    await movementRef.delete();
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'stock',
      action: 'delete',
      entityType: 'movimiento_stock',
      entityId: movementId,
      summary: `Eliminó un movimiento de stock (${tipo}, ${cantidad} u.)`,
    });
    res.json({ id: movementId });
  } catch (error) {
    const mapped = mapDeletionError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    console.error('Error deleting stock movement:', error);
    res.status(500).json({ error: 'Error deleting stock movement' });
  }
});

// Get one stock item
router.get('/:businessId/:itemId', async (req, res) => {
  try {
    const { businessId, itemId } = req.params;
    const doc = await db.collection(`negocios/${businessId}/stock`).doc(itemId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Item not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching stock item' });
  }
});

// Update stock item data
router.put('/:businessId/:itemId', async (req, res) => {
  try {
    const { businessId, itemId } = req.params;
    const { id, createdAt, negocioId, ...itemData } = req.body;

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(itemId);
    const existing = await itemRef.get();
    if (!existing.exists) return res.status(404).json({ error: 'Item not found' });

    const nombre = String(itemData.nombre ?? existing.data()?.nombre ?? '').trim();
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre del producto es obligatorio.' });
    }

    const duplicate = await findStockItemByName(businessId, nombre, itemId);
    if (duplicate) {
      return res.status(409).json({
        error: `Ya existe otro producto con el nombre «${duplicate.nombre ?? nombre}».`,
      });
    }

    const previousStock = Number(existing.data()?.stockActual) || 0;
    const nextStock = Number(itemData.stockActual) || 0;
    const stockDelta = nextStock - previousStock;

    await itemRef.update({
      ...itemData,
      stockActual: nextStock,
      stockMinimo: Number(itemData.stockMinimo) || 0,
      stockReservado: Number(itemData.stockReservado) || 0,
      controlaStock: itemData.controlaStock !== false,
      costo: Number(itemData.costo) || 0,
      precioSugerido: Number(itemData.precioSugerido) || 0,
      updatedAt: new Date().toISOString(),
    });

    if (stockDelta !== 0) {
      await db.collection(`negocios/${businessId}/movimientos_stock`).add({
        productoId: itemId,
        tipo: stockDelta > 0 ? 'entrada' : 'salida',
        cantidad: Math.abs(stockDelta),
        fecha: new Date().toISOString(),
        motivo: 'Ajuste manual desde edición de producto',
        origenGrupo: 'ajuste',
        origenTipo: 'ajuste_manual',
        usuarioId: 'admin',
        negocioId: businessId,
      });
    }

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'stock',
      action: 'update',
      entityType: 'producto',
      entityId: itemId,
      entityLabel: String(itemData.nombre ?? existing.data()?.nombre ?? itemId),
      summary: `Editó el producto ${String(itemData.nombre ?? existing.data()?.nombre ?? itemId)}`,
    });

    res.json({ id: itemId });
  } catch (error) {
    res.status(500).json({ error: 'Error updating stock item' });
  }
});

// Update stock (adjustment)
router.patch('/:businessId/:itemId', async (req, res) => {
  try {
    const { businessId, itemId } = req.params;
    const { quantity, motivo, usuarioId } = req.body;
    
    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(itemId);
    const item = await itemRef.get();
    
    if (!item.exists) return res.status(404).json({ error: 'Item not found' });
    
    const currentStock = item.data()?.stockActual || 0;
    const newStock = currentStock + quantity;
    
    await itemRef.update({ stockActual: newStock });
    
    // Record movement
    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: itemId,
      tipo: quantity > 0 ? 'entrada' : 'salida',
      cantidad: Math.abs(quantity),
      fecha: new Date().toISOString(),
      motivo,
      origenGrupo: 'ajuste',
      origenTipo: 'ajuste_manual',
      usuarioId,
      negocioId: businessId,
    });

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'stock',
      action: 'update',
      entityType: 'producto',
      entityId: itemId,
      entityLabel: String(item.data()?.nombre ?? itemId),
      summary: `Ajustó stock de ${String(item.data()?.nombre ?? itemId)} (${quantity > 0 ? '+' : ''}${quantity})`,
    });
    
    res.json({ success: true, newStock });
  } catch (error) {
    res.status(500).json({ error: 'Error updating stock' });
  }
});

// Delete stock item
router.delete('/:businessId/:itemId', async (req, res) => {
  try {
    const { businessId, itemId } = req.params;
    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(itemId);
    const existing = await itemRef.get();
    if (!existing.exists) return res.status(404).json({ error: 'Item not found' });

    const productName = String(existing.data()?.nombre ?? itemId);
    await itemRef.delete();
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'stock',
      action: 'delete',
      entityType: 'producto',
      entityId: itemId,
      entityLabel: productName,
      summary: `Eliminó el producto ${productName}`,
    });
    res.json({ id: itemId });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting stock item' });
  }
});

export default router;
