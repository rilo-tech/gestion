import express from 'express';
import { db } from '../firebase.ts';

const router = express.Router();

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db.collection(`negocios/${businessId}/proveedores`).get();
    const suppliers = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) =>
        String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es')
      );
    res.json(suppliers);
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ error: 'Error fetching suppliers' });
  }
});

router.get('/:businessId/:supplierId', async (req, res) => {
  try {
    const { businessId, supplierId } = req.params;
    const doc = await db.collection(`negocios/${businessId}/proveedores`).doc(supplierId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching supplier' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const docRef = await db.collection(`negocios/${businessId}/proveedores`).add({
      ...req.body,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: 'Error creating supplier' });
  }
});

router.patch('/:businessId/:supplierId', async (req, res) => {
  try {
    const { businessId, supplierId } = req.params;
    const { id, createdAt, ...supplierData } = req.body;
    await db.collection(`negocios/${businessId}/proveedores`).doc(supplierId).update({
      ...supplierData,
      updatedAt: new Date().toISOString(),
    });
    res.json({ id: supplierId });
  } catch (error) {
    res.status(500).json({ error: 'Error updating supplier' });
  }
});

router.delete('/:businessId/:supplierId', async (req, res) => {
  try {
    const { businessId, supplierId } = req.params;
    await db.collection(`negocios/${businessId}/proveedores`).doc(supplierId).delete();
    res.json({ id: supplierId });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting supplier' });
  }
});

export default router;
