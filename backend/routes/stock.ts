import express from 'express';
import { db } from '../firebase.ts';
import {
  mapDeletionError,
  validateOrderCancellation,
  validateStockMovementDeletion,
} from '../utils/deletion-guards.ts';
import {
  getStockOrigenNombre,
  normalizeOrderStockMotivo,
  normalizeStockOrigenes,
  type StockOrigenMovimiento,
} from '../utils/stock-movimientos.ts';
import {
  productControlsStock,
} from '../utils/stock-product.ts';
import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';
import {
  listStockReservations,
  listStockReservationsPage,
  listStockShortages,
  reconcileOrderStockFromProductReservations,
  syncPendingOrdersAfterStockChange,
} from '../utils/order-stock-reservations.ts';
import {
  getStockMetrics,
  recomputeStockMetrics,
  scheduleStockMetricsRefresh,
} from '../utils/stock-metrics.ts';
import {
  previewNextProductCode,
  resolveCodigoForCreate,
  regenerateProductCodesForCategory,
  resolveCodigoForUpdate,
  findStockItemByCodigo,
  findStockItemByBarcode,
  findStockItemByCodigoBarras,
  normalizeBarcodeKey,
  loadProductosCodigoConfig,
} from '../utils/product-code.ts';
import { findPrefijoOwnerForCodigo } from '../../shared/product-code-config.ts';
import {
  filterStockSearchEntries,
  type StockSearchEntry,
} from '../../shared/stock-search.ts';

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
    const paged = String(req.query.paged ?? '') === '1';
    if (paged) {
      const requestedLimit = Number(req.query.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(300, Math.max(20, Math.trunc(requestedLimit)))
        : 120;
      const cursor = String(req.query.cursor ?? '').trim();

      let query = db
        .collection(`negocios/${businessId}/stock`)
        .orderBy('nombre')
        .limit(limit + 1);

      if (cursor) {
        const cursorSnap = await db
          .collection(`negocios/${businessId}/stock`)
          .doc(cursor)
          .get();
        if (cursorSnap.exists) {
          query = query.startAfter(cursorSnap);
        }
      }

      const snapshot = await query.get();
      const hasMore = snapshot.docs.length > limit;
      const docs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;
      const items = docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : null;
      return res.json({ items, nextCursor, hasMore });
    }

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
    const controlsStock = productControlsStock(itemData);
    const stockActual = controlsStock ? Number(itemData.stockActual) || 0 : 0;
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

    const codigoResult = await resolveCodigoForCreate(businessId, {
      categoria: itemData.categoria,
      codigo: itemData.codigo,
    });
    if (!codigoResult.ok) {
      return res.status(codigoResult.status).json({ error: codigoResult.error });
    }

    const codigoBarras = normalizeBarcodeKey(itemData.codigoBarras);
    if (codigoBarras) {
      const duplicateBarcode = await findStockItemByCodigoBarras(businessId, codigoBarras);
      if (duplicateBarcode) {
        return res.status(409).json({
          error: `Ya existe un producto con el código de barras «${codigoBarras}».`,
        });
      }
    }

    const docRef = await db.collection(`negocios/${businessId}/stock`).add({
      ...itemData,
      ...(codigoResult.codigo ? { codigo: codigoResult.codigo } : {}),
      ...(codigoBarras ? { codigoBarras } : {}),
      stockActual,
      stockMinimo: controlsStock ? Number(itemData.stockMinimo) || 0 : 0,
      stockReservado: 0,
      controlaStock: controlsStock,
      permitirStockNegativo: controlsStock ? itemData.permitirStockNegativo !== false : false,
      costo: Number(itemData.costo) || 0,
      precioSugerido: Number(itemData.precioSugerido) || 0,
      negocioId: businessId,
      createdAt: new Date().toISOString(),
    });

    if (controlsStock && stockActual > 0) {
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
      await syncPendingOrdersAfterStockChange(businessId, [docRef.id]);
    }

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'stock',
      action: 'create',
      entityType: 'producto',
      entityId: docRef.id,
      entityLabel: String(itemData.nombre ?? ''),
      summary: `Creó el producto ${String(itemData.nombre ?? docRef.id)}`,
    });

    await recomputeStockMetrics(businessId);

    res.status(201).json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: 'Error creating stock item' });
  }
});

const STOCK_SEARCH_INDEX_FIELDS = [
  'nombre',
  'nombreBase',
  'categoria',
  'talle',
  'color',
  'codigo',
  'codigoBarras',
  'costo',
  'stockActual',
  'stockReservado',
  'controlaStock',
  'tipo',
] as const;

async function loadStockSearchIndex(businessId: string): Promise<StockSearchEntry[]> {
  const snapshot = await db
    .collection(`negocios/${businessId}/stock`)
    .select(...STOCK_SEARCH_INDEX_FIELDS)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as StockSearchEntry[];
}

// Índice liviano para búsqueda en cliente (pedidos, ventas, compras)
router.get('/:businessId/search-index', async (req, res) => {
  try {
    const { businessId } = req.params;
    const items = await loadStockSearchIndex(businessId);
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Error loading stock search index' });
  }
});

// Search stock items (fallback servidor; misma lógica que el filtro en cliente)
router.get('/:businessId/search', async (req, res) => {
  try {
    const { businessId } = req.params;
    const query = String(req.query.q ?? '').trim();
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    if (query.length < 2) {
      return res.json([]);
    }

    const items = await loadStockSearchIndex(businessId);
    res.json(filterStockSearchEntries(items, query, limit));
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
  origenes: StockOrigenMovimiento[]
): string {
  return getStockOrigenNombre(origenes, grupo);
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

    const numeroPedidoLabel =
      orderData?.numeroPedidoLabel ??
      (orderData?.numeroPedido ? String(orderData.numeroPedido).padStart(5, '0') : null);
    const motivoRaw = String(movement.motivo ?? '');
    const motivo =
      origenTipo.startsWith('pedido') && motivoRaw
        ? normalizeOrderStockMotivo(motivoRaw, origenTipo, numeroPedidoLabel)
        : movement.motivo;

    return {
      ...movement,
      motivo,
      productoNombre: productData?.nombre ?? null,
      origenGrupo,
      origenLabel: resolveOrigenLabel(origenGrupo, origenes),
      pedidoId,
      numeroPedidoLabel,
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
    const stockItemId = String(req.query.stockItemId ?? '').trim() || undefined;
    const paged = String(req.query.paged ?? '') === '1';
    if (paged) {
      const requestedLimit = Number(req.query.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(300, Math.max(20, Math.trunc(requestedLimit)))
        : undefined;
      const cursor = String(req.query.cursor ?? '').trim() || undefined;
      const page = await listStockReservationsPage(businessId, {
        stockItemIdFilter: stockItemId,
        limit,
        cursor,
      });
      return res.json(page);
    }

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
    scheduleStockMetricsRefresh(businessId);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Error reconciling stock reservations' });
  }
});

router.get('/:businessId/movements', async (req, res) => {
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
        .collection(`negocios/${businessId}/movimientos_stock`)
        .orderBy('fecha', 'desc')
        .limit(limit + 1);

      if (cursor) {
        const cursorSnap = await db
          .collection(`negocios/${businessId}/movimientos_stock`)
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
      const enriched = await enrichStockMovements(businessId, movements);
      const nextCursor =
        hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1].id : null;
      return res.json({ items: enriched, nextCursor, hasMore });
    }

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
    await recomputeStockMetrics(businessId);
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

router.get('/:businessId/metrics', async (req, res) => {
  try {
    const { businessId } = req.params;
    const forceRefresh = String(req.query.refresh ?? '') === '1';
    let metrics = await getStockMetrics(businessId);
    if (forceRefresh || !metrics.updatedAt) {
      metrics = await recomputeStockMetrics(businessId);
    }
    res.json(metrics);
  } catch (error) {
    console.error('Error fetching stock metrics:', error);
    res.status(500).json({ error: 'Error fetching stock metrics' });
  }
});

router.get('/:businessId/by-ids', async (req, res) => {
  try {
    const { businessId } = req.params;
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 60);

    if (ids.length === 0) {
      return res.json([]);
    }

    const refs = ids.map((id) => db.collection(`negocios/${businessId}/stock`).doc(id));
    const snaps = await db.getAll(...refs);
    const items = snaps
      .filter((snap) => snap.exists)
      .map((snap) => ({ id: snap.id, ...snap.data() }));

    res.json(items);
  } catch (error) {
    console.error('Error fetching stock items by ids:', error);
    res.status(500).json({ error: 'Error fetching stock items' });
  }
});

// Preview next auto code for a category (informational)
router.get('/:businessId/next-code', async (req, res) => {
  try {
    const { businessId } = req.params;
    const categoria = String(req.query.categoria ?? '').trim();
    if (!categoria) {
      return res.status(400).json({ error: 'Indicá la categoría.' });
    }
    const result = await previewNextProductCode(businessId, categoria);
    if ('error' in result) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('Error previewing next product code:', error);
    res.status(500).json({ error: 'Error al obtener el próximo código.' });
  }
});

// Check if a product code is available (duplicate + prefix hints)
router.get('/:businessId/codigo-check', async (req, res) => {
  try {
    const { businessId } = req.params;
    const codigo = String(req.query.codigo ?? '').trim();
    const excludeId = String(req.query.excludeId ?? '').trim();
    const categoria = String(req.query.categoria ?? '').trim();

    if (!codigo) {
      return res.json({ available: true, prefijoConflict: null });
    }

    const config = await loadProductosCodigoConfig(businessId);
    const duplicate = await findStockItemByCodigo(
      businessId,
      codigo,
      excludeId || undefined
    );
    const prefijoConflict = findPrefijoOwnerForCodigo(
      config,
      codigo,
      categoria || undefined
    );

    res.json({
      available: !duplicate,
      prefijoConflict,
    });
  } catch (error) {
    console.error('Error checking product code:', error);
    res.status(500).json({ error: 'Error al verificar el código.' });
  }
});

router.get('/:businessId/by-barcode', async (req, res) => {
  try {
    const { businessId } = req.params;
    const code = String(req.query.code ?? '').trim();
    if (!code) {
      return res.status(400).json({ error: 'Indicá el código de barras.' });
    }

    const found = await findStockItemByBarcode(businessId, code);
    if (!found) {
      return res.status(404).json({ error: 'No se encontró un producto con ese código.' });
    }

    res.json({ id: found.id, ...found.data });
  } catch (error) {
    console.error('Error fetching stock item by barcode:', error);
    res.status(500).json({ error: 'Error al buscar por código de barras.' });
  }
});

router.get('/:businessId/barcode-check', async (req, res) => {
  try {
    const { businessId } = req.params;
    const codigoBarras = normalizeBarcodeKey(req.query.codigoBarras);
    const excludeId = String(req.query.excludeId ?? '').trim();

    if (!codigoBarras) {
      return res.json({ available: true });
    }

    const duplicate = await findStockItemByCodigoBarras(
      businessId,
      codigoBarras,
      excludeId || undefined
    );
    res.json({ available: !duplicate });
  } catch (error) {
    console.error('Error checking barcode:', error);
    res.status(500).json({ error: 'Error al verificar el código de barras.' });
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

    const existingData = existing.data() ?? {};
    const codigoResult = await resolveCodigoForUpdate(
      businessId,
      itemId,
      {
        categoria: itemData.categoria,
        codigo: itemData.codigo,
      },
      {
        codigo: existingData.codigo,
        categoria: existingData.categoria,
      }
    );
    if (!codigoResult.ok) {
      return res.status(codigoResult.status).json({ error: codigoResult.error });
    }

    const codigoBarras = normalizeBarcodeKey(itemData.codigoBarras);
    if (codigoBarras) {
      const duplicateBarcode = await findStockItemByCodigoBarras(
        businessId,
        codigoBarras,
        itemId
      );
      if (duplicateBarcode) {
        return res.status(409).json({
          error: `Ya existe otro producto con el código de barras «${codigoBarras}».`,
        });
      }
    }

    const previousStock = Number(existingData.stockActual) || 0;
    const controlsStock = productControlsStock(itemData);
    const requestedStock = controlsStock ? Math.max(0, Number(itemData.stockActual) || 0) : 0;
    const nextStock = controlsStock ? requestedStock : 0;
    const stockDelta = nextStock - previousStock;

    await itemRef.update({
      ...itemData,
      ...(codigoResult.codigo ? { codigo: codigoResult.codigo } : { codigo: '' }),
      codigoBarras: codigoBarras || '',
      stockActual: nextStock,
      stockMinimo: controlsStock ? Number(itemData.stockMinimo) || 0 : 0,
      stockReservado: controlsStock ? Number(itemData.stockReservado) || 0 : 0,
      controlaStock: controlsStock,
      permitirStockNegativo: controlsStock ? itemData.permitirStockNegativo !== false : false,
      costo: Number(itemData.costo) || 0,
      precioSugerido: Number(itemData.precioSugerido) || 0,
      updatedAt: new Date().toISOString(),
    });

    if (codigoResult.regenerateOldCategoria) {
      await regenerateProductCodesForCategory(
        businessId,
        codigoResult.regenerateOldCategoria
      );
    }

    if (controlsStock && stockDelta !== 0) {
      await db.collection(`negocios/${businessId}/movimientos_stock`).add({
        productoId: itemId,
        tipo: stockDelta > 0 ? 'entrada' : 'salida',
        cantidad: Math.abs(stockDelta),
        fecha: new Date().toISOString(),
        motivo: 'Ajuste por edición de producto',
        origenGrupo: 'ajuste',
        origenTipo: 'edicion_producto',
        usuarioId: 'admin',
        negocioId: businessId,
      });
    }

    if (controlsStock && stockDelta > 0) {
      await syncPendingOrdersAfterStockChange(businessId, [itemId]);
    }

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'stock',
      action: 'update',
      entityType: 'producto',
      entityId: itemId,
      entityLabel: String(itemData.nombre ?? existing.data()?.nombre ?? itemId),
      summary: `Editó el producto ${String(itemData.nombre ?? existing.data()?.nombre ?? itemId)}`,
    });

    await recomputeStockMetrics(businessId);

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
    if (quantity > 0) {
      await syncPendingOrdersAfterStockChange(businessId, [itemId]);
    }

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'stock',
      action: 'update',
      entityType: 'producto',
      entityId: itemId,
      entityLabel: String(item.data()?.nombre ?? itemId),
      summary: `Ajustó stock de ${String(item.data()?.nombre ?? itemId)} (${quantity > 0 ? '+' : ''}${quantity})`,
    });

    await recomputeStockMetrics(businessId);

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
    await recomputeStockMetrics(businessId);
    res.json({ id: itemId });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting stock item' });
  }
});

export default router;
