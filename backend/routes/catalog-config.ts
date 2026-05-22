import express from 'express';
import { db } from '../firebase.ts';

const router = express.Router();

type FieldInputMode = 'lista' | 'texto';

const DEFAULT_APP_CONFIG = {
  productos: {
    tipos: [] as string[],
    categorias: [] as string[],
    talles: [] as string[],
    colores: [] as string[],
    modo: {
      tipos: 'texto' as FieldInputMode,
      categorias: 'texto' as FieldInputMode,
      talles: 'texto' as FieldInputMode,
      colores: 'texto' as FieldInputMode,
    },
  },
  clientes: {
    etiquetas: [] as string[],
    modo: { etiquetas: 'texto' as FieldInputMode },
  },
  caja: {
    conceptosIngreso: [] as string[],
    conceptosEgreso: [] as string[],
    modo: {
      conceptosIngreso: 'texto' as FieldInputMode,
      conceptosEgreso: 'texto' as FieldInputMode,
    },
  },
};

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'es')
  );
}

function normalizeMode(value: unknown, fallback: FieldInputMode = 'texto'): FieldInputMode {
  return value === 'lista' || value === 'texto' ? value : fallback;
}

function normalizeProductos(raw: Record<string, unknown> = {}) {
  const modo = (raw.modo as Record<string, unknown>) ?? {};
  let tipos = normalizeList(raw.tipos);
  let categorias = normalizeList(raw.categorias);
  let talles = normalizeList(raw.talles);
  let colores = normalizeList(raw.colores);

  if (Array.isArray(raw.campos)) {
    for (const item of raw.campos as Record<string, unknown>[]) {
      const nombre = String(item.nombre ?? '').toLowerCase();
      const opciones = normalizeList(item.opciones);
      if (nombre.includes('tipo') && tipos.length === 0) tipos = opciones;
      if (nombre.includes('categor') && categorias.length === 0) categorias = opciones;
      if (nombre.includes('talle') && talles.length === 0) talles = opciones;
      if (nombre.includes('color') && colores.length === 0) colores = opciones;
    }
  }

  return {
    tipos,
    categorias,
    talles,
    colores,
    modo: {
      tipos: normalizeMode(modo.tipos, tipos.length > 0 ? 'lista' : 'texto'),
      categorias: normalizeMode(modo.categorias, categorias.length > 0 ? 'lista' : 'texto'),
      talles: normalizeMode(modo.talles, talles.length > 0 ? 'lista' : 'texto'),
      colores: normalizeMode(modo.colores, colores.length > 0 ? 'lista' : 'texto'),
    },
  };
}

function normalizeAppConfig(data: Record<string, unknown> = {}) {
  const productos = (data.productos as Record<string, unknown>) ?? data;
  const clientes = (data.clientes as Record<string, unknown>) ?? {};
  const clientesModo = (clientes.modo as Record<string, unknown>) ?? {};

  const etiquetas = normalizeList(clientes.etiquetas);
  const caja = (data.caja as Record<string, unknown>) ?? {};
  const cajaModo = (caja.modo as Record<string, unknown>) ?? {};
  const conceptosIngreso = normalizeList(caja.conceptosIngreso);
  const conceptosEgreso = normalizeList(caja.conceptosEgreso);

  return {
    productos: normalizeProductos(productos as Record<string, unknown>),
    clientes: {
      etiquetas,
      modo: {
        etiquetas: normalizeMode(
          clientesModo.etiquetas,
          etiquetas.length > 0 ? 'lista' : 'texto'
        ),
      },
    },
    caja: {
      conceptosIngreso,
      conceptosEgreso,
      modo: {
        conceptosIngreso: normalizeMode(
          cajaModo.conceptosIngreso,
          conceptosIngreso.length > 0 ? 'lista' : 'texto'
        ),
        conceptosEgreso: normalizeMode(
          cajaModo.conceptosEgreso,
          conceptosEgreso.length > 0 ? 'lista' : 'texto'
        ),
      },
    },
  };
}

async function loadAppConfig(businessId: string) {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (appDoc.exists) {
    return normalizeAppConfig(appDoc.data() as Record<string, unknown>);
  }

  const legacyDoc = await db.doc(`negocios/${businessId}/config/catalogo`).get();
  if (legacyDoc.exists) {
    return normalizeAppConfig({ productos: legacyDoc.data() });
  }

  return DEFAULT_APP_CONFIG;
}

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    res.json(await loadAppConfig(businessId));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching app config' });
  }
});

router.patch('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const payload = {
      ...normalizeAppConfig(req.body as Record<string, unknown>),
      updatedAt: new Date().toISOString(),
    };

    await db.doc(`negocios/${businessId}/config/app`).set(payload);
    res.json(payload);
  } catch (error) {
    console.error('Error updating app config:', error);
    res.status(500).json({ error: 'Error updating app config' });
  }
});

router.get('/:businessId/catalogo', async (req, res) => {
  try {
    const { businessId } = req.params;
    const config = await loadAppConfig(businessId);
    res.json(config.productos);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching catalog config' });
  }
});

export default router;
