import express from 'express';
import { db } from '../firebase.ts';
import { normalizeCajaOrigenes } from '../utils/cash-origenes.ts';
import {
  normalizeCajaAmbitos,
} from '../utils/caja-ambitos.ts';
import {
  normalizeStockOrigenes,
  normalizeStockTipos,
} from '../utils/stock-movimientos.ts';
import {
  diffConfigRemovals,
  getConfigItemUsage,
  getRemovalsUsage,
  type ConfigRemovalKind,
} from '../utils/config-usage.ts';
import { normalizeOrderPedidosConfig } from '../utils/order-config.ts';
import { createCompanyRouter } from './create-company-router.ts';
import { requireSettingsAccess } from '../auth/middleware.ts';

const router = createCompanyRouter();

type FieldInputMode = 'lista' | 'texto';
type CajaConceptoTipo = 'ingreso' | 'egreso' | 'ambos';

interface CajaConcepto {
  nombre: string;
  tipo: CajaConceptoTipo;
}

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
  proveedores: {
    etiquetas: [] as string[],
    modo: { etiquetas: 'texto' as FieldInputMode },
  },
  caja: {
    conceptos: [] as CajaConcepto[],
    origenes: normalizeCajaOrigenes([]),
    ambitos: [] as ReturnType<typeof normalizeCajaAmbitos>,
    modo: {
      conceptos: 'texto' as FieldInputMode,
    },
  },
  pedidos: normalizeOrderPedidosConfig({}),
  stock: {
    tipos: normalizeStockTipos([]),
    origenes: normalizeStockOrigenes([]),
  },
};

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'es')
  );
}

function normalizeCajaConceptoTipo(value: unknown): CajaConceptoTipo {
  if (value === 'ingreso' || value === 'egreso' || value === 'ambos') return value;
  if (value === 'suma') return 'ingreso';
  if (value === 'resta') return 'egreso';
  return 'ambos';
}

function mergeCajaConcepto(
  map: Map<string, CajaConcepto>,
  nombre: string,
  tipo: CajaConceptoTipo
) {
  const key = nombre.toLowerCase();
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { nombre, tipo });
    return;
  }

  if (existing.tipo === tipo || existing.tipo === 'ambos' || tipo === 'ambos') {
    existing.tipo = 'ambos';
    return;
  }

  existing.tipo = 'ambos';
}

function sortCajaConceptos(conceptos: CajaConcepto[]): CajaConcepto[] {
  return [...conceptos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function normalizeCajaConceptos(caja: Record<string, unknown>): CajaConcepto[] {
  const raw = caja.conceptos;
  if (Array.isArray(raw) && raw.length > 0) {
    const map = new Map<string, CajaConcepto>();
    for (const item of raw) {
      if (typeof item === 'string') {
        const nombre = item.trim();
        if (nombre) mergeCajaConcepto(map, nombre, 'ambos');
        continue;
      }

      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const nombre = String(obj.nombre ?? '').trim();
      if (!nombre) continue;
      mergeCajaConcepto(map, nombre, normalizeCajaConceptoTipo(obj.tipo));
    }
    return sortCajaConceptos([...map.values()]);
  }

  const ingreso = normalizeList(caja.conceptosIngreso);
  const egreso = normalizeList(caja.conceptosEgreso);
  const map = new Map<string, CajaConcepto>();
  for (const nombre of ingreso) mergeCajaConcepto(map, nombre, 'ingreso');
  for (const nombre of egreso) mergeCajaConcepto(map, nombre, 'egreso');
  return sortCajaConceptos([...map.values()]);
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
  const proveedores = (data.proveedores as Record<string, unknown>) ?? {};
  const proveedoresModo = (proveedores.modo as Record<string, unknown>) ?? {};

  const etiquetas = normalizeList(clientes.etiquetas);
  const etiquetasProveedores = normalizeList(proveedores.etiquetas);
  const caja = (data.caja as Record<string, unknown>) ?? {};
  const cajaModo = (caja.modo as Record<string, unknown>) ?? {};
  const conceptos = normalizeCajaConceptos(caja);
  const origenes = normalizeCajaOrigenes(caja.origenes);
  const pedidos = (data.pedidos as Record<string, unknown>) ?? {};
  const stock = (data.stock as Record<string, unknown>) ?? {};

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
    proveedores: {
      etiquetas: etiquetasProveedores,
      modo: {
        etiquetas: normalizeMode(
          proveedoresModo.etiquetas,
          etiquetasProveedores.length > 0 ? 'lista' : 'texto'
        ),
      },
    },
    caja: {
      conceptos,
      origenes,
      ambitos: normalizeCajaAmbitos(caja),
      modo: {
        conceptos: normalizeMode(
          cajaModo.conceptos ??
            (cajaModo.conceptosIngreso === 'lista' || cajaModo.conceptosEgreso === 'lista'
              ? 'lista'
              : undefined),
          conceptos.length > 0 ? 'lista' : 'texto'
        ),
      },
    },
    pedidos: normalizeOrderPedidosConfig(pedidos),
    stock: {
      tipos: normalizeStockTipos(stock.tipos),
      origenes: normalizeStockOrigenes(stock.origenes),
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

router.post('/:businessId/usage-check', requireSettingsAccess, async (req, res) => {
  try {
    const { businessId } = req.params;
    const kind = String(req.body?.kind ?? '').trim() as ConfigRemovalKind;
    const value = String(req.body?.value ?? '').trim();
    if (!kind || !value) {
      return res.status(400).json({ error: 'Faltan kind o value.' });
    }

    const usage = await getConfigItemUsage(businessId, kind, value);
    res.json({ usage, inUse: usage.length > 0 });
  } catch (error) {
    console.error('Error checking config usage:', error);
    res.status(500).json({ error: 'No se pudo verificar el uso de la opción.' });
  }
});

router.patch('/:businessId', requireSettingsAccess, async (req, res) => {
  try {
    const { businessId } = req.params;
    const body = { ...(req.body as Record<string, unknown>) };
    const confirmConfigRemovals = body.confirmConfigRemovals === true;
    delete body.confirmConfigRemovals;

    const current = await loadAppConfig(businessId);
    const next = normalizeAppConfig(body);
    const removals = diffConfigRemovals(current, next);

    if (removals.length > 0 && !confirmConfigRemovals) {
      const usage = await getRemovalsUsage(businessId, removals);
      if (usage.length > 0) {
        return res.status(409).json({
          error: 'Hay opciones en uso. Confirmá la eliminación para continuar.',
          usage,
          requiresConfirmation: true,
        });
      }
    }

    const payload = {
      ...next,
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
