import { db } from '../firebase.ts';

export type CategoriaStockRegla = {
  configurado: boolean;
  controlaStock: boolean;
  permitirStockNegativo: boolean;
};

export function normalizeCategoriasSinStock(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'es')
  );
}

function findCategoriaStockKey(
  map: Record<string, CategoriaStockRegla>,
  categoria: string
): string | undefined {
  const target = categoria.trim().toLowerCase();
  if (!target) return undefined;
  return Object.keys(map).find((key) => key.trim().toLowerCase() === target);
}

export function normalizeCategoriasStock(
  raw: unknown,
  categorias: string[] = [],
  legacySinStock: string[] = []
): Record<string, CategoriaStockRegla> {
  const result: Record<string, CategoriaStockRegla> = {};

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const nombre = key.trim();
      if (!nombre || !value || typeof value !== 'object') continue;
      const entry = value as Record<string, unknown>;
      result[nombre] = {
        configurado: entry.configurado === true,
        controlaStock: entry.controlaStock !== false,
        permitirStockNegativo: entry.permitirStockNegativo !== false,
      };
    }
  }

  for (const categoria of categorias) {
    const nombre = categoria.trim();
    if (!nombre || result[nombre]) continue;
    result[nombre] = {
      configurado: false,
      controlaStock: true,
      permitirStockNegativo: true,
    };
  }

  for (const categoria of legacySinStock) {
    const nombre = categoria.trim();
    if (!nombre) continue;
    result[nombre] = {
      configurado: true,
      controlaStock: false,
      permitirStockNegativo: false,
    };
  }

  return result;
}

export function getCategoriaStockRegla(
  map: Record<string, CategoriaStockRegla> | undefined,
  categoria: string | undefined
): CategoriaStockRegla | null {
  const cat = String(categoria ?? '').trim();
  if (!cat || !map) return null;

  const key = findCategoriaStockKey(map, cat);
  if (!key) return null;

  const regla = map[key];
  return regla?.configurado ? regla : null;
}

export function productControlsStock(data: Record<string, unknown> | undefined): boolean {
  return data?.controlaStock !== false;
}

export function getStockDisponibleFromValues(
  stockActual: number,
  stockReservado: number
): number {
  return Math.max(0, (Number(stockActual) || 0) - (Number(stockReservado) || 0));
}

/** Unidades físicas en depósito: libre + reservado (una sola vez, sin duplicar). */
export function getStockEnDeposito(stockActual: number, stockReservado: number): number {
  const reservado = Math.max(0, Number(stockReservado) || 0);
  return getStockDisponibleFromValues(stockActual, stockReservado) + reservado;
}

export function productPermitsNegativeStock(data: Record<string, unknown> | undefined): boolean {
  return data?.permitirStockNegativo !== false;
}

export async function countStockItemsInCategoria(
  businessId: string,
  categoria: string
): Promise<number> {
  const target = categoria.trim().toLowerCase();
  if (!target) return 0;

  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  return snap.docs.filter((doc) => {
    const prodCat = String(doc.data().categoria ?? '')
      .trim()
      .toLowerCase();
    return prodCat === target;
  }).length;
}

export async function syncStockItemsWithCategoryDefaults(
  businessId: string,
  categoria: string
): Promise<number> {
  const configSnap = await db.doc(`negocios/${businessId}/config/app`).get();
  const productos = (configSnap.data()?.productos ?? {}) as Record<string, unknown>;
  const categorias = normalizeCategoriasSinStock(productos.categorias);
  const legacySinStock = normalizeCategoriasSinStock(productos.categoriasSinStock);
  const map = normalizeCategoriasStock(productos.categoriasStock, categorias, legacySinStock);
  const regla = getCategoriaStockRegla(map, categoria);
  if (!regla) return 0;

  const target = categoria.trim().toLowerCase();
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  let updated = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const prodCat = String(data.categoria ?? '')
      .trim()
      .toLowerCase();
    if (prodCat !== target) continue;

    const nextControls = regla.controlaStock;
    const nextPermitir = regla.controlaStock ? regla.permitirStockNegativo : false;
    const currentControls = data.controlaStock !== false;
    const currentPermitir = data.permitirStockNegativo !== false;
    const needsStockReset =
      !nextControls &&
      ((Number(data.stockActual) || 0) !== 0 ||
        (Number(data.stockReservado) || 0) !== 0 ||
        (Number(data.stockMinimo) || 0) !== 0);

    if (currentControls === nextControls && currentPermitir === nextPermitir && !needsStockReset) {
      continue;
    }

    await doc.ref.update({
      controlaStock: nextControls,
      permitirStockNegativo: nextPermitir,
      ...(nextControls
        ? {}
        : {
            stockActual: 0,
            stockReservado: 0,
            stockMinimo: 0,
          }),
      updatedAt: new Date().toISOString(),
    });
    updated++;
  }

  return updated;
}

/** @deprecated Usar syncStockItemsWithCategoryDefaults */
export async function syncStockItemsWithCategoryRules(_businessId: string): Promise<number> {
  return 0;
}

export async function loadCategoriasSinStock(businessId: string): Promise<string[]> {
  const snap = await db.doc(`negocios/${businessId}/config/app`).get();
  const productos = (snap.data()?.productos ?? {}) as Record<string, unknown>;
  return normalizeCategoriasSinStock(productos.categoriasSinStock);
}

export async function loadCategoriasStock(
  businessId: string
): Promise<Record<string, CategoriaStockRegla>> {
  const snap = await db.doc(`negocios/${businessId}/config/app`).get();
  const productos = (snap.data()?.productos ?? {}) as Record<string, unknown>;
  const categorias = normalizeCategoriasSinStock(productos.categorias);
  const legacySinStock = normalizeCategoriasSinStock(productos.categoriasSinStock);
  return normalizeCategoriasStock(productos.categoriasStock, categorias, legacySinStock);
}
