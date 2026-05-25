export interface CajaOrigen {
  grupo: string;
  nombre: string;
}

export const DEFAULT_CAJA_ORIGENES: CajaOrigen[] = [
  { grupo: 'venta', nombre: 'Ventas' },
  { grupo: 'pedido', nombre: 'Pedidos' },
  { grupo: 'compra', nombre: 'Compra' },
];

export type OrigenGrupo = 'pedido' | 'venta' | 'compra' | 'manual' | 'otro';

export function slugifyOrigenGrupo(nombre: string): string {
  const slug = nombre
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug || 'origen';
}

export function normalizeCajaOrigenes(raw: unknown): CajaOrigen[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_CAJA_ORIGENES];
  }

  const map = new Map<string, CajaOrigen>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const grupo = String(obj.grupo ?? '').trim().toLowerCase();
    const nombre = String(obj.nombre ?? '').trim();
    if (!grupo || !nombre) continue;
    map.set(grupo, { grupo, nombre });
  }

  if (map.size === 0) return [...DEFAULT_CAJA_ORIGENES];
  return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function getCashOrigenNombre(origenes: CajaOrigen[], grupo: string): string {
  const match = origenes.find((item) => item.grupo === grupo);
  if (match) return match.nombre;

  if (grupo === 'pedido') return 'Pedidos';
  if (grupo === 'venta') return 'Ventas';
  if (grupo === 'compra') return 'Compra';
  if (grupo === 'manual') return 'Manuales';
  return 'Otro';
}
