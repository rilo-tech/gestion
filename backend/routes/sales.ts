import express from 'express';
import { db } from '../firebase.ts';

const router = express.Router();

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db.collection(`negocios/${businessId}/ventas`).orderBy('fecha', 'desc').get();
    const sales = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching sales' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const ventaData = req.body;
    
    const docRef = await db.collection(`negocios/${businessId}/ventas`).add({
      ...ventaData,
      fecha: new Date().toISOString()
    });
    
    // If it comes from an order, mark order as delivered/closed
    if (ventaData.pedidoId) {
      await db.collection(`negocios/${businessId}/pedidos`).doc(ventaData.pedidoId).update({
        estado: 'entregado'
      });
    }

    // Register income in Cash
    await db.collection(`negocios/${businessId}/movimientos_caja`).add({
      tipo: 'ingreso',
      monto: ventaData.total,
      medio: ventaData.medioPago,
      concepto: `Venta #${docRef.id.slice(-6)}`,
      fecha: new Date().toISOString(),
      origenId: docRef.id,
      negocioId: businessId
    });

    res.status(201).json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: 'Error creating sale' });
  }
});

export default router;
