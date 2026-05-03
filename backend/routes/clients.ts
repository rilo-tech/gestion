import express from 'express';
import { db } from '../firebase.ts';

const router = express.Router();

// Get all clients for a business
router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db.collection(`negocios/${businessId}/clientes`).get();
    const clients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching clients' });
  }
});

// Create client
router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const clientData = req.body;
    const docRef = await db.collection(`negocios/${businessId}/clientes`).add({
      ...clientData,
      createdAt: new Date().toISOString()
    });
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: 'Error creating client' });
  }
});

export default router;
