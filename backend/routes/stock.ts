import express from 'express';
import { db } from '../firebase.ts';

const router = express.Router();

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
      usuarioId,
      negocioId: businessId
    });
    
    res.json({ success: true, newStock });
  } catch (error) {
    res.status(500).json({ error: 'Error updating stock' });
  }
});

export default router;
