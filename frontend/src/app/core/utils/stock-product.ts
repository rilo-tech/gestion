import type { StockItem } from '../services/stock.service';

export type CategoriaStockRegla = {
  configurado: boolean;
  controlaStock: boolean;
  permitirStockNegativo: boolean;
};

export function normalizeCategoriasStock(
  raw: Record<string, CategoriaStockRegla> | undefined,
  categorias: string[] = [],
  legacySinStock: string[] = []
): Record<string, CategoriaStockRegla> {
  const result: Record<string, CategoriaStockRegla> = { ...(raw ?? {}) };

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

  const direct = map[cat];
  if (direct?.configurado) return direct;

  const key = Object.keys(map).find((entry) => entry.trim().toLowerCase() === cat.toLowerCase());
  const match = key ? map[key] : undefined;
  return match?.configurado ? match : null;
}

export function applyCategoriaStockReglaToForm(regla: CategoriaStockRegla): {
  controlaStock: boolean;
  permitirStockNegativo: boolean;
} {
  return {
    controlaStock: regla.controlaStock,
    permitirStockNegativo: regla.controlaStock ? regla.permitirStockNegativo : false,
  };
}

export function productControlsStock(
  item: Pick<StockItem, 'controlaStock'> | undefined
): boolean {
  return item?.controlaStock !== false;
}

export function productPermitsNegativeStock(
  item: Pick<StockItem, 'permitirStockNegativo'> | undefined
): boolean {
  return item?.permitirStockNegativo !== false;
}

export function itemControlsStock(
  item: Pick<StockItem, 'controlaStock' | 'categoria'> | undefined,
  _categoriasSinStock: string[] = []
): boolean {
  return productControlsStock(item);
}
