import express from 'express';
import { db } from '../firebase.ts';

import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';

const router = createCompanyRouter();

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
        .collection(`negocios/${businessId}/proveedores`)
        .orderBy('nombre')
        .limit(limit + 1);

      if (cursor) {
        const cursorSnap = await db
          .collection(`negocios/${businessId}/proveedores`)
          .doc(cursor)
          .get();
        if (cursorSnap.exists) {
          query = query.startAfter(cursorSnap);
        }
      }

      const snapshot = await query.get();
      const hasMore = snapshot.docs.length > limit;
      const docs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;
      const items = docs.map((doc) => {
        const data = doc.data();
        const saldoPendiente = Number(data.saldoPendiente) || 0;
        return {
          id: doc.id,
          ...data,
          saldoPendiente,
          debe: saldoPendiente > 0,
        };
      });
      const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : null;
      return res.json({ items, nextCursor, hasMore });
    }

    const snapshot = await db.collection(`negocios/${businessId}/proveedores`).get();
    const suppliers = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        const saldoPendiente = Number(data.saldoPendiente) || 0;
        return {
          id: doc.id,
          ...data,
          saldoPendiente,
          debe: saldoPendiente > 0,
        };
      })
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
    const data = doc.data() ?? {};
    const saldoPendiente = Number(data.saldoPendiente) || 0;
    res.json({
      id: doc.id,
      ...data,
      saldoPendiente,
      debe: saldoPendiente > 0,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching supplier' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { id, createdAt, saldoPendiente, debe, ...supplierData } = req.body ?? {};
    const docRef = await db.collection(`negocios/${businessId}/proveedores`).add({
      ...supplierData,
      createdAt: new Date().toISOString(),
    });
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'suppliers',
      action: 'create',
      entityType: 'proveedor',
      entityId: docRef.id,
      entityLabel: String(supplierData.nombre ?? ''),
      summary: `Creó el proveedor ${String(supplierData.nombre ?? docRef.id)}`,
    });
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: 'Error creating supplier' });
  }
});

router.patch('/:businessId/:supplierId', async (req, res) => {
  try {
    const { businessId, supplierId } = req.params;
    const { id, createdAt, saldoPendiente, debe, ...supplierData } = req.body;
    await db.collection(`negocios/${businessId}/proveedores`).doc(supplierId).update({
      ...supplierData,
      updatedAt: new Date().toISOString(),
    });
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'suppliers',
      action: 'update',
      entityType: 'proveedor',
      entityId: supplierId,
      entityLabel: String(supplierData.nombre ?? ''),
      summary: `Editó el proveedor ${String(supplierData.nombre ?? supplierId)}`,
    });
    res.json({ id: supplierId });
  } catch (error) {
    res.status(500).json({ error: 'Error updating supplier' });
  }
});

router.delete('/:businessId/:supplierId', async (req, res) => {
  try {
    const { businessId, supplierId } = req.params;
    const snap = await db.collection(`negocios/${businessId}/proveedores`).doc(supplierId).get();
    const supplierName = String(snap.data()?.nombre ?? supplierId);
    await db.collection(`negocios/${businessId}/proveedores`).doc(supplierId).delete();
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'suppliers',
      action: 'delete',
      entityType: 'proveedor',
      entityId: supplierId,
      entityLabel: supplierName,
      summary: `Eliminó el proveedor ${supplierName}`,
    });
    res.json({ id: supplierId });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting supplier' });
  }
});

export default router;
