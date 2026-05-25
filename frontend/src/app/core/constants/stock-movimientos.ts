export type StockMovimientoTipoGrupo = 'entrada' | 'salida';

export interface StockTipoMovimiento {
  grupo: StockMovimientoTipoGrupo;
  nombre: string;
}

export interface StockOrigenMovimiento {
  grupo: string;
  nombre: string;
}

export const DEFAULT_STOCK_TIPOS: StockTipoMovimiento[] = [
  { grupo: 'entrada', nombre: 'Entrada' },
  { grupo: 'salida', nombre: 'Salida' },
];

export const DEFAULT_STOCK_ORIGENES: StockOrigenMovimiento[] = [
  { grupo: 'compra', nombre: 'Compras' },
  { grupo: 'pedido_venta', nombre: 'Pedidos/ventas' },
  { grupo: 'carga_inicial', nombre: 'Carga inicial' },
  { grupo: 'ajuste', nombre: 'Ajuste' },
];

export function normalizeStockTipos(raw: StockTipoMovimiento[] | undefined): StockTipoMovimiento[] {
  const map = new Map<StockMovimientoTipoGrupo, StockTipoMovimiento>();
  for (const item of DEFAULT_STOCK_TIPOS) {
    map.set(item.grupo, { ...item });
  }

  for (const entry of raw ?? []) {
    const grupo = entry.grupo?.trim().toLowerCase();
    const nombre = entry.nombre?.trim();
    if ((grupo === 'entrada' || grupo === 'salida') && nombre) {
      map.set(grupo, { grupo, nombre });
    }
  }

  return DEFAULT_STOCK_TIPOS.map((item) => map.get(item.grupo)!);
}

export function getStockTipos(tipos: StockTipoMovimiento[] | undefined): StockTipoMovimiento[] {
  if (tipos?.length) return normalizeStockTipos(tipos);
  return [...DEFAULT_STOCK_TIPOS];
}

export function getStockOrigenes(origenes: StockOrigenMovimiento[] | undefined): StockOrigenMovimiento[] {
  if (origenes?.length) return origenes;
  return [...DEFAULT_STOCK_ORIGENES];
}

export function mapToConfigOrigenGrupo(grupo: string): string {
  if (grupo === 'pedido' || grupo === 'venta') return 'pedido_venta';
  return grupo;
}

export function getStockTipoNombre(tipos: StockTipoMovimiento[] | undefined, grupo: string): string {
  const match = getStockTipos(tipos).find((item) => item.grupo === grupo);
  if (match) return match.nombre;
  if (grupo === 'entrada') return 'Entrada';
  if (grupo === 'salida') return 'Salida';
  return grupo;
}

export function getStockOrigenNombre(
  origenes: StockOrigenMovimiento[] | undefined,
  rawGrupo: string
): string {
  const configGrupo = mapToConfigOrigenGrupo(rawGrupo);
  const match = getStockOrigenes(origenes).find((item) => item.grupo === configGrupo);
  if (match) return match.nombre;

  if (configGrupo === 'compra') return 'Compras';
  if (configGrupo === 'pedido_venta') return 'Pedidos/ventas';
  if (configGrupo === 'carga_inicial') return 'Carga inicial';
  if (configGrupo === 'ajuste') return 'Ajuste';
  return 'Otro';
}

export function matchesStockOrigenFilter(rawGrupo: string, filterGrupo: string): boolean {
  if (filterGrupo === 'all') return true;
  return mapToConfigOrigenGrupo(rawGrupo) === filterGrupo || rawGrupo === filterGrupo;
}
