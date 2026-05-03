import express from 'express';
import { db } from '../firebase.ts';

const router = express.Router();

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db.collection(`negocios/${businessId}/pedidos`).orderBy('fechaEntrega', 'asc').get();
    const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching orders' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const orderData = req.body;
    const docRef = await db.collection(`negocios/${businessId}/pedidos`).add({
      ...orderData,
      createdAt: new Date().toISOString()
    });
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: 'Error creating order' });
  }
});

export default router;
