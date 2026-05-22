import express from 'express';
import { db } from '../firebase.ts';

const router = express.Router();

function formatCompraLabel(compraId: string): string {
  return compraId.slice(-6).toUpperCase();
}

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
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
    const proveedor = String(req.body.proveedor ?? '').trim();
    const notas = String(req.body.notas ?? '').trim();
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];

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

    res.status(201).json({ id: docRef.id, compraLabel });
  } catch (error) {
    console.error('Error creating purchase:', error);
    res.status(500).json({ error: 'Error creating purchase' });
  }
});

export default router;
