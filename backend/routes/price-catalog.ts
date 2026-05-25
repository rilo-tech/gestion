import express from 'express';
import { db } from '../firebase.ts';
import { createCompanyRouter } from './create-company-router.ts';

const router = createCompanyRouter();

export interface PriceCatalogQuantityRange {
  cantidadMin: number;
  cantidadMax: number | null;
  precioUnitario: number;
}

export interface PriceCatalogVariant {
  nombre: string;
  precioReferencia?: number;
  rangosCantidad: PriceCatalogQuantityRange[];
}

function normalizeQuantityRanges(value: unknown): PriceCatalogQuantityRange[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const cantidadMin = Math.max(1, Number(row.cantidadMin) || 1);
      const cantidadMaxRaw = row.cantidadMax;
      const cantidadMax =
        cantidadMaxRaw == null || cantidadMaxRaw === ''
          ? null
          : Math.max(cantidadMin, Number(cantidadMaxRaw) || cantidadMin);
      const precioUnitario = Number(row.precioUnitario) || 0;
      if (precioUnitario <= 0) return null;
      return { cantidadMin, cantidadMax, precioUnitario };
    })
    .filter((item): item is PriceCatalogQuantityRange => item != null)
    .sort((a, b) => a.cantidadMin - b.cantidadMin);
}

function normalizeVariant(value: unknown): PriceCatalogVariant | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const nombre = String(row.nombre ?? '').trim();
  if (!nombre) return null;
  const rangosCantidad = normalizeQuantityRanges(row.rangosCantidad);
  const precioReferencia = Number(row.precioReferencia) || 0;
  return {
    nombre,
    precioReferencia: precioReferencia > 0 ? precioReferencia : undefined,
    rangosCantidad,
  };
}

function normalizeVariantes(value: unknown): PriceCatalogVariant[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeVariant)
    .filter((item): item is PriceCatalogVariant => item != null);
}

function migrateLegacyVariantes(data: Record<string, unknown>): PriceCatalogVariant[] {
  const precioBase = Number(data.precioBase) || 0;
  const rangosCantidad = normalizeQuantityRanges(data.rangosCantidad);
  const personalizaciones = Array.isArray(data.personalizaciones) ? data.personalizaciones : [];

  const variantes: PriceCatalogVariant[] = [];

  variantes.push({
    nombre: 'Sin estampado',
    precioReferencia: precioBase > 0 && !rangosCantidad.length ? precioBase : undefined,
    rangosCantidad,
  });

  for (const item of personalizaciones) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const nombre = String(row.nombre ?? '').trim();
    if (!nombre) continue;
    const extra = Number(row.precioAdicional) || 0;
    variantes.push({
      nombre,
      precioReferencia:
        precioBase + extra > 0 && !rangosCantidad.length ? precioBase + extra : undefined,
      rangosCantidad: rangosCantidad.map((range) => ({
        ...range,
        precioUnitario: range.precioUnitario + extra,
      })),
    });
  }

  return variantes.filter((variant) => variant.nombre);
}

function normalizeEntry(data: Record<string, unknown>, id: string) {
  let variantes = normalizeVariantes(data.variantes);
  if (!variantes.length) {
    variantes = migrateLegacyVariantes(data);
  }

  return {
    id,
    nombre: String(data.nombre ?? '').trim(),
    variantes,
    notas: String(data.notas ?? '').trim() || undefined,
    activo: data.activo !== false,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
  };
}

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db.collection(`negocios/${businessId}/catalogo_precios`).get();
    const entries = snapshot.docs
      .map((doc) => normalizeEntry(doc.data() as Record<string, unknown>, doc.id))
      .filter((entry) => entry.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    res.json(entries);
  } catch (error) {
    console.error('Error fetching price catalog:', error);
    res.status(500).json({ error: 'Error fetching price catalog' });
  }
});

router.get('/:businessId/:entryId', async (req, res) => {
  try {
    const { businessId, entryId } = req.params;
    const doc = await db
      .collection(`negocios/${businessId}/catalogo_precios`)
      .doc(entryId)
      .get();
    if (!doc.exists) return res.status(404).json({ error: 'Entry not found' });
    res.json(normalizeEntry(doc.data() as Record<string, unknown>, doc.id));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching price catalog entry' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { id, createdAt, updatedAt, ...raw } = req.body ?? {};
    const entry = normalizeEntry(raw as Record<string, unknown>, '');
    if (!entry.nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio.' });
    }

    const docRef = await db.collection(`negocios/${businessId}/catalogo_precios`).add({
      nombre: entry.nombre,
      variantes: entry.variantes,
      notas: entry.notas ?? null,
      activo: entry.activo,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    console.error('Error creating price catalog entry:', error);
    res.status(500).json({ error: 'Error creating price catalog entry' });
  }
});

router.patch('/:businessId/:entryId', async (req, res) => {
  try {
    const { businessId, entryId } = req.params;
    const { id, createdAt, ...raw } = req.body ?? {};
    const entry = normalizeEntry(raw as Record<string, unknown>, entryId);
    if (!entry.nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio.' });
    }

    await db.collection(`negocios/${businessId}/catalogo_precios`).doc(entryId).update({
      nombre: entry.nombre,
      variantes: entry.variantes,
      notas: entry.notas ?? null,
      activo: entry.activo,
      updatedAt: new Date().toISOString(),
    });
    res.json({ id: entryId });
  } catch (error) {
    console.error('Error updating price catalog entry:', error);
    res.status(500).json({ error: 'Error updating price catalog entry' });
  }
});

router.delete('/:businessId/:entryId', async (req, res) => {
  try {
    const { businessId, entryId } = req.params;
    await db.collection(`negocios/${businessId}/catalogo_precios`).doc(entryId).delete();
    res.json({ id: entryId });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting price catalog entry' });
  }
});

export default router;
