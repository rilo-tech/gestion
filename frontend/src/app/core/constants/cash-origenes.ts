export type CashOrigenGrupo = 'pedido' | 'venta' | 'compra' | 'manual' | 'otro';

export interface CajaOrigen {
  grupo: string;
  nombre: string;
}

export const DEFAULT_CAJA_ORIGENES: CajaOrigen[] = [
  { grupo: 'venta', nombre: 'Ventas' },
  { grupo: 'pedido', nombre: 'Pedidos' },
  { grupo: 'compra', nombre: 'Compra' },
];

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

export function getCashOrigenes(origenes: CajaOrigen[] | undefined): CajaOrigen[] {
  if (origenes?.length) return origenes;
  return DEFAULT_CAJA_ORIGENES;
}

export function getCashOrigenNombre(
  origenes: CajaOrigen[] | undefined,
  grupo: string
): string {
  const match = getCashOrigenes(origenes).find((item) => item.grupo === grupo);
  if (match) return match.nombre;

  if (grupo === 'pedido') return 'Pedidos';
  if (grupo === 'venta') return 'Ventas';
  if (grupo === 'compra') return 'Compra';
  if (grupo === 'manual') return 'Manuales';
  return 'Otro';
}
