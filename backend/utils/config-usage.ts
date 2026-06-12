import { db } from '../firebase.ts';
import { BUSINESS_CASH_AMBITO_ID } from './caja-ambitos.ts';

export interface ConfigUsageHit {
  module: string;
  label: string;
  count: number;
}

export type ConfigRemovalKind =
  | 'clientes.etiquetas'
  | 'proveedores.etiquetas'
  | 'productos.categorias'
  | 'productos.talles'
  | 'productos.colores'
  | 'caja.conceptos'
  | 'caja.ambitos'
  | 'caja.origenes'
  | 'stock.origenes'
  | 'finanzas.categoriasGasto'
  | 'finanzas.conceptosIngreso'
  | 'finanzas.mediosPago'
  | 'finanzas.tarjetas'
  | 'colaboradores.tiposExtra';

export interface ConfigRemovalItem {
  kind: ConfigRemovalKind;
  value: string;
  display?: string;
}

export class ConfigInUseError extends Error {
  readonly statusCode = 409;

  constructor(
    message: string,
    readonly usage: ConfigUsageHit[]
  ) {
    super(message);
    this.name = 'ConfigInUseError';
  }
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function countArrayContains(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  field: string,
  value: string
): number {
  const needle = norm(value);
  return docs.filter((doc) => {
    const raw = doc.data()[field];
    if (!Array.isArray(raw)) return false;
    return raw.some((item) => norm(String(item)) === needle);
  }).length;
}

function countFieldEquals(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  field: string,
  value: string
): number {
  const needle = norm(value);
  return docs.filter((doc) => norm(String(doc.data()[field] ?? '')) === needle).length;
}

async function loadCollection(businessId: string, name: string) {
  return db.collection(`negocios/${businessId}/${name}`).get();
}

export async function getConfigItemUsage(
  businessId: string,
  kind: ConfigRemovalKind,
  value: string
): Promise<ConfigUsageHit[]> {
  const trimmed = value.trim();
  if (!trimmed) return [];

  switch (kind) {
    case 'clientes.etiquetas': {
      const snap = await loadCollection(businessId, 'clientes');
      const count = countArrayContains(snap.docs, 'etiquetas', trimmed);
      return count > 0 ? [{ module: 'clientes', label: 'Clientes', count }] : [];
    }
    case 'proveedores.etiquetas': {
      const snap = await loadCollection(businessId, 'proveedores');
      const count = countArrayContains(snap.docs, 'etiquetas', trimmed);
      return count > 0 ? [{ module: 'proveedores', label: 'Proveedores', count }] : [];
    }
    case 'productos.categorias':
    case 'productos.talles':
    case 'productos.colores': {
      const stockFieldByKind: Record<string, string> = {
        'productos.categorias': 'categoria',
        'productos.talles': 'talle',
        'productos.colores': 'color',
      };
      const stockField = stockFieldByKind[kind];
      const snap = await loadCollection(businessId, 'stock');
      const count = countFieldEquals(snap.docs, stockField, trimmed);
      return count > 0 ? [{ module: 'stock', label: 'Productos de stock', count }] : [];
    }
    case 'caja.conceptos': {
      const snap = await loadCollection(businessId, 'movimientos_caja');
      const count = countFieldEquals(snap.docs, 'concepto', trimmed);
      return count > 0 ? [{ module: 'caja', label: 'Movimientos de caja', count }] : [];
    }
    case 'caja.ambitos': {
      const id = trimmed.toLowerCase();
      const [cajaSnap, obligSnap, cuotasSnap] = await Promise.all([
        loadCollection(businessId, 'movimientos_caja'),
        loadCollection(businessId, 'cuentas_pagar_obligaciones'),
        loadCollection(businessId, 'cuentas_pagar_cuotas'),
      ]);
      const hits: ConfigUsageHit[] = [];
      const cajaCount = countFieldEquals(cajaSnap.docs, 'ambito', id);
      const obligCount = countFieldEquals(obligSnap.docs, 'ambito', id);
      const cuotasCount = countFieldEquals(cuotasSnap.docs, 'ambito', id);
      if (cajaCount > 0) hits.push({ module: 'caja', label: 'Movimientos de caja', count: cajaCount });
      if (obligCount > 0) {
        hits.push({ module: 'payables', label: 'Cuentas a pagar (obligaciones)', count: obligCount });
      }
      if (cuotasCount > 0) {
        hits.push({ module: 'payables', label: 'Cuentas a pagar (cuotas)', count: cuotasCount });
      }
      return hits;
    }
    case 'caja.origenes':
    case 'stock.origenes': {
      const grupo = trimmed.toLowerCase();
      const collection = kind === 'caja.origenes' ? 'movimientos_caja' : 'movimientos_stock';
      const label = kind === 'caja.origenes' ? 'Movimientos de caja' : 'Movimientos de stock';
      const snap = await loadCollection(businessId, collection);
      const count = countFieldEquals(snap.docs, 'origenGrupo', grupo);
      return count > 0
        ? [{ module: kind === 'caja.origenes' ? 'caja' : 'stock', label, count }]
        : [];
    }
    case 'finanzas.categoriasGasto': {
      const id = trimmed.toLowerCase();
      const [obligSnap, comprasSnap, cajaSnap] = await Promise.all([
        loadCollection(businessId, 'cuentas_pagar_obligaciones'),
        loadCollection(businessId, 'compras'),
        loadCollection(businessId, 'movimientos_caja'),
      ]);
      const hits: ConfigUsageHit[] = [];
      const obligCount = countFieldEquals(obligSnap.docs, 'categoriaId', id);
      const cajaCount = countFieldEquals(cajaSnap.docs, 'categoriaId', id);
      const comprasCount = comprasSnap.docs.filter((doc) => {
        const data = doc.data();
        if (norm(String(data.categoriaId ?? '')) === id) return true;
        const items = Array.isArray(data.items) ? data.items : [];
        return items.some((line) => {
          if (!line || typeof line !== 'object') return false;
          return norm(String((line as Record<string, unknown>).categoriaId ?? '')) === id;
        });
      }).length;
      if (obligCount > 0) {
        hits.push({ module: 'payables', label: 'Cuentas a pagar', count: obligCount });
      }
      if (comprasCount > 0) {
        hits.push({ module: 'purchases', label: 'Compras', count: comprasCount });
      }
      if (cajaCount > 0) {
        hits.push({ module: 'cash', label: 'Caja', count: cajaCount });
      }
      return hits;
    }
    case 'finanzas.conceptosIngreso': {
      const snap = await loadCollection(businessId, 'movimientos_caja');
      const count = snap.docs.filter((doc) => {
        const data = doc.data();
        if (norm(String(data.tipo ?? '')) !== 'ingreso') return false;
        return norm(String(data.concepto ?? '')) === norm(trimmed);
      }).length;
      return count > 0 ? [{ module: 'cash', label: 'Ingresos de caja', count }] : [];
    }
    case 'finanzas.mediosPago': {
      const id = trimmed.toLowerCase();
      const [comprasSnap, cuotasSnap, cajaSnap] = await Promise.all([
        loadCollection(businessId, 'compras'),
        loadCollection(businessId, 'cuentas_pagar_cuotas'),
        loadCollection(businessId, 'movimientos_caja'),
      ]);
      const hits: ConfigUsageHit[] = [];
      const comprasCount = comprasSnap.docs.filter((doc) => {
        const data = doc.data();
        const pago = data.pago;
        if (pago && typeof pago === 'object') {
          return norm(String((pago as Record<string, unknown>).medioPagoId ?? '')) === id;
        }
        return norm(String(data.medioPagoId ?? '')) === id;
      }).length;
      const cuotasCount = countFieldEquals(cuotasSnap.docs, 'medioPagoId', id);
      const cajaCount = countFieldEquals(cajaSnap.docs, 'medioPagoId', id);
      if (comprasCount > 0) {
        hits.push({ module: 'purchases', label: 'Compras', count: comprasCount });
      }
      if (cuotasCount > 0) {
        hits.push({ module: 'payables', label: 'Cuotas en cuentas a pagar', count: cuotasCount });
      }
      if (cajaCount > 0) {
        hits.push({ module: 'caja', label: 'Movimientos de caja', count: cajaCount });
      }
      return hits;
    }
    case 'colaboradores.tiposExtra': {
      const id = trimmed.toLowerCase();
      const snap = await loadCollection(businessId, 'colaboradores_movimientos');
      const count = countFieldEquals(snap.docs, 'extraTipo', id);
      return count > 0
        ? [{ module: 'collaborators', label: 'Extras de colaboradores', count }]
        : [];
    }
    case 'finanzas.tarjetas': {
      const id = trimmed.toLowerCase();
      const [cuotasSnap, comprasSnap] = await Promise.all([
        loadCollection(businessId, 'cuentas_pagar_cuotas'),
        loadCollection(businessId, 'compras'),
      ]);
      const hits: ConfigUsageHit[] = [];
      const cuotasCount = countFieldEquals(cuotasSnap.docs, 'tarjetaId', id);
      const comprasCount = comprasSnap.docs.filter((doc) => {
        const data = doc.data();
        const pago = data.pago;
        if (pago && typeof pago === 'object') {
          return norm(String((pago as Record<string, unknown>).tarjetaId ?? '')) === id;
        }
        return norm(String(data.tarjetaId ?? '')) === id;
      }).length;
      if (cuotasCount > 0) {
        hits.push({ module: 'payables', label: 'Cuotas de tarjeta', count: cuotasCount });
      }
      if (comprasCount > 0) {
        hits.push({ module: 'purchases', label: 'Compras', count: comprasCount });
      }
      return hits;
    }
    default:
      return [];
  }
}

export async function getRemovalsUsage(
  businessId: string,
  removals: ConfigRemovalItem[]
): Promise<ConfigUsageHit[]> {
  const merged = new Map<string, ConfigUsageHit>();

  for (const removal of removals) {
    const hits = await getConfigItemUsage(businessId, removal.kind, removal.value);
    for (const hit of hits) {
      const key = `${hit.module}:${hit.label}`;
      const existing = merged.get(key);
      if (existing) {
        existing.count += hit.count;
      } else {
        merged.set(key, { ...hit });
      }
    }
  }

  return [...merged.values()].filter((hit) => hit.count > 0);
}

type NormalizedConfig = {
  productos: { tipos: string[]; categorias: string[]; talles: string[]; colores: string[] };
  clientes: { etiquetas: string[] };
  proveedores: { etiquetas: string[] };
  caja: {
    conceptos: { nombre: string }[];
    origenes: { grupo: string; nombre: string }[];
    ambitos: { id: string; label: string }[];
  };
  stock: { origenes: { grupo: string; nombre: string }[] };
  finanzas: {
    categoriasGasto: { id: string; label: string }[];
    conceptosIngreso: { id: string; label: string }[];
    tarjetas: { id: string; label: string }[];
  };
  colaboradores: {
    tiposExtra: { id: string; nombre: string }[];
  };
};

function removedStrings(prev: string[], next: string[], kind: ConfigRemovalKind): ConfigRemovalItem[] {
  const nextSet = new Set(next.map(norm));
  return prev
    .filter((value) => !nextSet.has(norm(value)))
    .map((value) => ({ kind, value }));
}

export function diffConfigRemovals(prev: NormalizedConfig, next: NormalizedConfig): ConfigRemovalItem[] {
  const removals: ConfigRemovalItem[] = [
    ...removedStrings(prev.clientes.etiquetas, next.clientes.etiquetas, 'clientes.etiquetas'),
    ...removedStrings(prev.proveedores.etiquetas, next.proveedores.etiquetas, 'proveedores.etiquetas'),
    ...removedStrings(prev.productos.categorias, next.productos.categorias, 'productos.categorias'),
    ...removedStrings(prev.productos.talles, next.productos.talles, 'productos.talles'),
    ...removedStrings(prev.productos.colores, next.productos.colores, 'productos.colores'),
  ];

  const nextConceptos = new Set(next.caja.conceptos.map((item) => norm(item.nombre)));
  for (const concepto of prev.caja.conceptos) {
    if (!nextConceptos.has(norm(concepto.nombre))) {
      removals.push({ kind: 'caja.conceptos', value: concepto.nombre, display: concepto.nombre });
    }
  }

  const nextAmbitos = new Set(next.caja.ambitos.map((item) => norm(item.id)));
  for (const ambito of prev.caja.ambitos) {
    if (norm(ambito.id) === BUSINESS_CASH_AMBITO_ID) continue;
    if (!nextAmbitos.has(norm(ambito.id))) {
      removals.push({ kind: 'caja.ambitos', value: ambito.id, display: ambito.label });
    }
  }

  const nextCajaOrigenGrupos = new Set(next.caja.origenes.map((item) => norm(item.grupo)));
  for (const origen of prev.caja.origenes) {
    if (!nextCajaOrigenGrupos.has(norm(origen.grupo))) {
      removals.push({ kind: 'caja.origenes', value: origen.grupo, display: origen.nombre });
    }
  }

  const nextStockOrigenGrupos = new Set(next.stock.origenes.map((item) => norm(item.grupo)));
  for (const origen of prev.stock.origenes) {
    if (!nextStockOrigenGrupos.has(norm(origen.grupo))) {
      removals.push({ kind: 'stock.origenes', value: origen.grupo, display: origen.nombre });
    }
  }

  const nextCategorias = new Set(
    next.finanzas.categoriasGasto.map((item) => norm(item.id))
  );
  for (const cat of prev.finanzas.categoriasGasto) {
    if (!nextCategorias.has(norm(cat.id))) {
      removals.push({
        kind: 'finanzas.categoriasGasto',
        value: cat.id,
        display: cat.label,
      });
    }
  }

  const nextConceptosIngreso = new Set(
    next.finanzas.conceptosIngreso.map((item) => norm(item.id))
  );
  for (const concepto of prev.finanzas.conceptosIngreso) {
    if (!nextConceptosIngreso.has(norm(concepto.id))) {
      removals.push({
        kind: 'finanzas.conceptosIngreso',
        value: concepto.id,
        display: concepto.label,
      });
    }
  }

  const nextMedios = new Set(next.finanzas.mediosPago.map((item) => norm(item.id)));
  for (const medio of prev.finanzas.mediosPago) {
    if (!nextMedios.has(norm(medio.id))) {
      removals.push({
        kind: 'finanzas.mediosPago',
        value: medio.id,
        display: medio.label,
      });
    }
  }

  const nextTarjetas = new Set(next.finanzas.tarjetas.map((item) => norm(item.id)));
  for (const tarjeta of prev.finanzas.tarjetas) {
    if (!nextTarjetas.has(norm(tarjeta.id))) {
      removals.push({
        kind: 'finanzas.tarjetas',
        value: tarjeta.id,
        display: tarjeta.label,
      });
    }
  }

  const nextTiposExtra = new Set(
    next.colaboradores.tiposExtra.map((item) => norm(item.id))
  );
  for (const tipo of prev.colaboradores.tiposExtra) {
    if (!nextTiposExtra.has(norm(tipo.id))) {
      removals.push({
        kind: 'colaboradores.tiposExtra',
        value: tipo.id,
        display: tipo.nombre,
      });
    }
  }

  return removals;
}
