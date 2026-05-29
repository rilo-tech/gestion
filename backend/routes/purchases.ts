import express from 'express';
import { db } from '../firebase.ts';
import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';
import { scheduleStockMetricsRefresh } from '../utils/stock-metrics.ts';

const router = createCompanyRouter();

function formatCompraLabel(compraId: string): string {
  return compraId.slice(-6).toUpperCase();
}

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
        .collection(`negocios/${businessId}/compras`)
        .orderBy('fecha', 'desc')
        .limit(limit + 1);

      if (cursor) {
        const cursorSnap = await db
          .collection(`negocios/${businessId}/compras`)
          .doc(cursor)
          .get();
        if (cursorSnap.exists) {
          query = query.startAfter(cursorSnap);
        }
      }

      const snapshot = await query.get();
      const hasMore = snapshot.docs.length > limit;
      const docs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;
      const items = docs.map((doc) => ({
        id: doc.id,
        compraLabel: formatCompraLabel(doc.id),
        ...doc.data(),
      }));
      const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : null;
      return res.json({ items, nextCursor, hasMore });
    }

    const snapshot = await db
      .collection(`negocios/${businessId}/compras`)
      .orderBy('fecha', 'desc')
      .get();
    const purchases = snapshot.docs.map((doc) => ({
      id: doc.id,
      compraLabel: formatCompraLabel(doc.id),
      ...doc.data(),
    }));
    res.json(purchases);
  } catch (error) {
    console.error('Error fetching purchases:', error);
    res.status(500).json({ error: 'Error fetching purchases' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const proveedorId = String(req.body.proveedorId ?? '').trim();
    let proveedor = String(req.body.proveedor ?? '').trim();
    const notas = String(req.body.notas ?? '').trim();
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];

    if (proveedorId) {
      const supplierSnap = await db
        .collection(`negocios/${businessId}/proveedores`)
        .doc(proveedorId)
        .get();
      if (supplierSnap.exists) {
        proveedor = String(supplierSnap.data()?.nombre ?? proveedor).trim();
      }
    }

    const items = rawItems
      .map((line: Record<string, unknown>) => ({
        productoId: String(line.productoId ?? '').trim(),
        cantidad: Number(line.cantidad) || 0,
        costoUnitario: Number(line.costoUnitario) || 0,
        productoNombre: String(line.productoNombre ?? '').trim(),
      }))
      .filter((line) => line.productoId && line.cantidad > 0);

    if (items.length === 0) {
      return res.status(400).json({ error: 'Agregá al menos un producto con cantidad.' });
    }

    const normalizedItems = [];
    let total = 0;

    for (const line of items) {
      const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.productoId);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) {
        return res.status(400).json({ error: 'Uno de los productos seleccionados no existe.' });
      }

      const itemData = itemSnap.data() ?? {};
      const subtotal = line.cantidad * line.costoUnitario;
      total += subtotal;

      normalizedItems.push({
        productoId: line.productoId,
        productoNombre: line.productoNombre || itemData.nombre || 'Producto',
        cantidad: line.cantidad,
        costoUnitario: line.costoUnitario,
        subtotal,
      });
    }

    const docRef = await db.collection(`negocios/${businessId}/compras`).add({
      proveedorId: proveedorId || null,
      proveedor,
      notas,
      items: normalizedItems,
      total,
      fecha: new Date().toISOString(),
      negocioId: businessId,
    });

    const compraLabel = formatCompraLabel(docRef.id);
    const timestamp = new Date().toISOString();

    for (const line of normalizedItems) {
      const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.productoId);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) continue;

      const currentStock = Number(itemSnap.data()?.stockActual) || 0;
      await itemRef.update({
        stockActual: currentStock + line.cantidad,
        ...(line.costoUnitario > 0 ? { costo: line.costoUnitario } : {}),
        updatedAt: timestamp,
      });

      await db.collection(`negocios/${businessId}/movimientos_stock`).add({
        productoId: line.productoId,
        tipo: 'entrada',
        cantidad: line.cantidad,
        fecha: timestamp,
        motivo: `Compra #${compraLabel}`,
        origenId: docRef.id,
        origenTipo: 'compra',
        origenGrupo: 'compra',
        compraId: docRef.id,
        usuarioId: 'admin',
        negocioId: businessId,
      });
    }

    scheduleStockMetricsRefresh(businessId);

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'purchases',
      action: 'create',
      entityType: 'compra',
      entityId: docRef.id,
      entityLabel: compraLabel,
      summary: `Registró compra #${compraLabel} por $${total}${proveedor ? ` · ${proveedor}` : ''}`,
    });

    res.status(201).json({ id: docRef.id, compraLabel });
  } catch (error) {
    console.error('Error creating purchase:', error);
    res.status(500).json({ error: 'Error creating purchase' });
  }
});

export default router;
