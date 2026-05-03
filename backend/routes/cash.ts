import express from 'express';
import { db } from '../firebase.ts';

const router = express.Router();

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db.collection(`negocios/${businessId}/movimientos_caja`).orderBy('fecha', 'desc').get();
    const movements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(movements);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching cash movements' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const movementData = req.body;
    const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
      ...movementData,
      fecha: new Date().toISOString()
    });
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: 'Error creating cash movement' });
  }
});

export default router;
