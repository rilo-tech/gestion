import express from 'express';
import { db } from '../firebase.ts';
import { createCompanyRouter } from './create-company-router.ts';
import { requirePermission, type AuthenticatedRequest } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';
import {
  parsePurchaseInput,
  persistPurchase,
  persistPurchaseDraft,
  updatePurchaseDraft,
  confirmPurchaseDraft,
  updateConfirmedPurchase,
  repairPurchasePayables,
  deletePurchase,
  enrichPurchasesForList,
} from '../utils/purchase-finance.ts';
import { loadFinanzasConfig } from '../utils/finance-config.ts';
import { allocatePurchaseNumber, resolvePurchaseLabel } from '../utils/purchase-number.ts';
import { scheduleStockMetricsRefresh } from '../utils/stock-metrics.ts';
import { syncPendingOrdersAfterStockChange } from '../utils/order-stock-reservations.ts';

const router = createCompanyRouter();

function mapPurchaseDoc(doc: { id: string; data: () => Record<string, unknown> | undefined }) {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    ...data,
    compraLabel: resolvePurchaseLabel({ ...data, id: doc.id }),
  };
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
      const items = await enrichPurchasesForList(
        businessId,
        docs.map((doc) => mapPurchaseDoc(doc))
      );
      const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : null;
      return res.json({ items, nextCursor, hasMore });
    }

    const snapshot = await db
      .collection(`negocios/${businessId}/compras`)
      .orderBy('fecha', 'desc')
      .get();
    const purchases = await enrichPurchasesForList(
      businessId,
      snapshot.docs.map((doc) => mapPurchaseDoc(doc))
    );
    res.json(purchases);
  } catch (error) {
    console.error('Error fetching purchases:', error);
    res.status(500).json({ error: 'Error fetching purchases' });
  }
});

/** Legacy purchase creation (product lines only, no payment block). */
async function createLegacyPurchase(businessId: string, body: Record<string, unknown>) {
  const proveedorId = String(body.proveedorId ?? '').trim();
  let proveedor = String(body.proveedor ?? '').trim();
  const notas = String(body.notas ?? '').trim();
  const rawItems = Array.isArray(body.items) ? body.items : [];

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
      tipoLinea: 'stock',
      ambito: 'negocio',
      afectaStock: true,
      enOferta: line.enOferta === true,
      descripcion: String(line.productoNombre ?? '').trim(),
      importe: (Number(line.cantidad) || 0) * (Number(line.costoUnitario) || 0),
    }))
    .filter((line) => line.productoId && line.cantidad > 0);

  if (items.length === 0) {
    return { error: 'Agregá al menos un producto con cantidad.' };
  }

  const normalizedItems = [];
  let total = 0;

  for (const line of items) {
    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.productoId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) {
      return { error: 'Uno de los productos seleccionados no existe.' };
    }

    const itemData = itemSnap.data() ?? {};
    const subtotal = line.cantidad * line.costoUnitario;
    total += subtotal;

    normalizedItems.push({
      ...line,
      productoNombre: line.productoNombre || itemData.nombre || 'Producto',
      cantidad: line.cantidad,
      costoUnitario: line.costoUnitario,
      subtotal,
    });
  }

  const { numero: numeroCompra, label: compraLabel } = await allocatePurchaseNumber(businessId);

  const docRef = await db.collection(`negocios/${businessId}/compras`).add({
    proveedorId: proveedorId || null,
    proveedor,
    notas,
    numeroCompra,
    compraLabel,
    items: normalizedItems,
    total,
    totalNegocio: total,
    totalPersonal: 0,
    pago: { medioPagoId: 'efectivo', cuotas: 1 },
    estado: 'recibida',
    fecha: new Date().toISOString(),
    negocioId: businessId,
  });
  const timestamp = new Date().toISOString();

  for (const line of normalizedItems) {
    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.productoId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const currentStock = Number(itemSnap.data()?.stockActual) || 0;
    await itemRef.update({
      stockActual: currentStock + line.cantidad,
      ...(line.costoUnitario > 0 && !line.enOferta ? { costo: line.costoUnitario } : {}),
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

  await syncPendingOrdersAfterStockChange(
    businessId,
    normalizedItems.map((line) => line.productoId)
  );

  scheduleStockMetricsRefresh(businessId);
  return { id: docRef.id, compraLabel, total, proveedor, numeroCompra };
}

router.get('/:businessId/:compraId', async (req, res) => {
  try {
    const { businessId, compraId } = req.params;
    const snap = await db.collection(`negocios/${businessId}/compras`).doc(compraId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Compra no encontrada.' });
    }
    res.json(mapPurchaseDoc(snap));
  } catch (error) {
    console.error('Error fetching purchase:', error);
    res.status(500).json({ error: 'Error fetching purchase' });
  }
});

router.post(
  '/:businessId/:compraId/repair-payables',
  requirePermission('records.edit'),
  async (req, res) => {
    try {
      const { businessId, compraId } = req.params;
      const result = await repairPurchasePayables(businessId, compraId);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'PURCHASE_NOT_FOUND') {
        return res.status(404).json({ error: 'Compra no encontrada.' });
      }
      if (message === 'NOT_CONFIRMED') {
        return res.status(400).json({ error: 'La compra debe estar confirmada.' });
      }
      if (message) {
        return res.status(400).json({ error: message });
      }
      console.error('Error repairing purchase payables:', err);
      res.status(500).json({ error: 'No se pudieron generar las cuotas.' });
    }
  }
);

router.put(
  '/:businessId/:compraId',
  requirePermission('records.edit'),
  async (req, res) => {
    try {
      const { businessId, compraId } = req.params;
      const finanzas = await loadFinanzasConfig(businessId);
      const parsed = await parsePurchaseInput(businessId, req.body as Record<string, unknown>, {
        finanzas,
      });
      if (parsed.error || !parsed.input) {
        return res.status(400).json({ error: parsed.error ?? 'Datos de compra inválidos.' });
      }

      let result;
      try {
        result = await updateConfirmedPurchase(businessId, compraId, parsed.input);
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message === 'PURCHASE_NOT_FOUND') {
          return res.status(404).json({ error: 'Compra no encontrada.' });
        }
        if (message === 'NOT_CONFIRMED') {
          return res.status(400).json({ error: 'Solo se pueden editar compras ya registradas (no borradores).' });
        }
        if (message.startsWith('PRODUCT_NOT_FOUND')) {
          return res.status(400).json({ error: 'Uno de los productos seleccionados no existe.' });
        }
        if (message === 'PAID_INSTALLMENTS') {
          return res.status(400).json({
            error: 'No se puede editar: hay cuotas de esta compra ya pagadas en Cuentas a pagar.',
          });
        }
        if (message) {
          return res.status(400).json({ error: message });
        }
        throw err;
      }

      res.json(result);

      void logActivityFromRequest(req as AuthenticatedRequest, businessId, {
        module: 'purchases',
        action: 'update',
        entityType: 'compra',
        entityId: result.id,
        entityLabel: result.compraLabel,
        summary: `Editó compra #${result.compraLabel}`,
      }).catch((err) => console.error('Error logging purchase update activity:', err));
    } catch (error) {
      console.error('Error updating purchase:', error);
      res.status(500).json({ error: 'Error updating purchase' });
    }
  }
);

router.post('/:businessId/:compraId/confirm', async (req, res) => {
  try {
    const { businessId, compraId } = req.params;

    let result;
    try {
      result = await confirmPurchaseDraft(businessId, compraId);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'PURCHASE_NOT_FOUND') {
        return res.status(404).json({ error: 'Compra no encontrada.' });
      }
      if (message === 'NOT_DRAFT') {
        return res.status(400).json({ error: 'Solo se pueden confirmar compras en borrador.' });
      }
      if (message.startsWith('PRODUCT_NOT_FOUND')) {
        return res.status(400).json({ error: 'Uno de los productos seleccionados no existe.' });
      }
      throw err;
    }

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'purchases',
      action: 'confirm',
      entityType: 'compra',
      entityId: result.id,
      entityLabel: result.compraLabel,
      summary: `Confirmó compra #${result.compraLabel}`,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Error confirming purchase:', error);
    res.status(500).json({ error: 'Error confirming purchase' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const body = req.body as Record<string, unknown>;
    const isDraft = body.draft === true || body.estado === 'borrador';
    const draftCompraId = String(body.compraId ?? body.id ?? '').trim();
    const hasPaymentBlock = Boolean(body.pago) || Boolean(body.medioPagoId);
    const hasLineTypes = Array.isArray(body.items)
      && (body.items as Record<string, unknown>[]).some((line) => line.tipoLinea);

    if (isDraft && (hasPaymentBlock || hasLineTypes)) {
      const parsed = await parsePurchaseInput(businessId, body, { relaxed: true });
      if (parsed.error || !parsed.input) {
        return res.status(400).json({ error: parsed.error ?? 'Datos de compra inválidos.' });
      }

      const result = draftCompraId
        ? await updatePurchaseDraft(businessId, draftCompraId, parsed.input)
        : await persistPurchaseDraft(businessId, parsed.input);

      await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
        module: 'purchases',
        action: 'draft',
        entityType: 'compra',
        entityId: result.id,
        entityLabel: 'Borrador',
        summary: draftCompraId
          ? `Actualizó borrador de compra`
          : `Guardó borrador de compra`,
      });

      return res.status(draftCompraId ? 200 : 201).json(result);
    }

    if (!hasPaymentBlock && !hasLineTypes) {
      const legacy = await createLegacyPurchase(businessId, body);
      if ('error' in legacy && legacy.error) {
        return res.status(400).json({ error: legacy.error });
      }
      await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
        module: 'purchases',
        action: 'create',
        entityType: 'compra',
        entityId: legacy.id!,
        entityLabel: legacy.compraLabel!,
        summary: `Registró compra #${legacy.compraLabel} por $${legacy.total}${legacy.proveedor ? ` · ${legacy.proveedor}` : ''}`,
      });
      return res.status(201).json({ id: legacy.id, compraLabel: legacy.compraLabel });
    }

    const parsed = await parsePurchaseInput(businessId, body);
    if (parsed.error || !parsed.input) {
      return res.status(400).json({ error: parsed.error ?? 'Datos de compra inválidos.' });
    }

    let result;
    try {
      result = await persistPurchase(businessId, parsed.input);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.startsWith('PRODUCT_NOT_FOUND')) {
        return res.status(400).json({ error: 'Uno de los productos seleccionados no existe.' });
      }
      throw err;
    }

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'purchases',
      action: 'create',
      entityType: 'compra',
      entityId: result.id,
      entityLabel: result.compraLabel,
      summary: `Registró compra #${result.compraLabel} por $${parsed.input.total}${parsed.input.proveedor ? ` · ${parsed.input.proveedor}` : ''}`,
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating purchase:', error);
    res.status(500).json({ error: 'Error creating purchase' });
  }
});

router.delete(
  '/:businessId/:compraId',
  requirePermission('records.delete'),
  async (req, res) => {
    try {
      const { businessId, compraId } = req.params;

      let result;
      try {
        result = await deletePurchase(businessId, compraId);
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message === 'PURCHASE_NOT_FOUND') {
          return res.status(404).json({ error: 'Compra no encontrada.' });
        }
        if (message === 'PAID_INSTALLMENTS') {
          return res.status(400).json({
            error: 'No se puede eliminar: hay cuotas de esta compra ya pagadas en Cuentas a pagar.',
          });
        }
        if (message) {
          return res.status(400).json({ error: message });
        }
        throw err;
      }

      await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
        module: 'purchases',
        action: 'delete',
        entityType: 'compra',
        entityId: result.id,
        entityLabel: result.compraLabel,
        summary: `Eliminó compra #${result.compraLabel}`,
      });

      res.json(result);
    } catch (error) {
      console.error('Error deleting purchase:', error);
      res.status(500).json({ error: 'No se pudo eliminar la compra.' });
    }
  }
);

export default router;
