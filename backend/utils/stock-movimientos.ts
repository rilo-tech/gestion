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

export function normalizeStockTipos(raw: unknown): StockTipoMovimiento[] {
  const map = new Map<StockMovimientoTipoGrupo, StockTipoMovimiento>();
  for (const item of DEFAULT_STOCK_TIPOS) {
    map.set(item.grupo, { ...item });
  }

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const grupo = String(obj.grupo ?? '').trim().toLowerCase();
      const nombre = String(obj.nombre ?? '').trim();
      if ((grupo === 'entrada' || grupo === 'salida') && nombre) {
        map.set(grupo, { grupo, nombre });
      }
    }
  }

  return DEFAULT_STOCK_TIPOS.map((item) => map.get(item.grupo)!);
}

export function normalizeStockOrigenes(raw: unknown): StockOrigenMovimiento[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_STOCK_ORIGENES];
  }

  const map = new Map<string, StockOrigenMovimiento>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const grupo = String(obj.grupo ?? '').trim().toLowerCase();
    const nombre = String(obj.nombre ?? '').trim();
    if (!grupo || !nombre) continue;
    map.set(grupo, { grupo, nombre });
  }

  if (map.size === 0) return [...DEFAULT_STOCK_ORIGENES];
  return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function mapToConfigOrigenGrupo(grupo: string): string {
  if (grupo === 'pedido' || grupo === 'venta') return 'pedido_venta';
  return grupo;
}

export function getStockTipoNombre(tipos: StockTipoMovimiento[], grupo: string): string {
  const match = tipos.find((item) => item.grupo === grupo);
  if (match) return match.nombre;
  if (grupo === 'entrada') return 'Entrada';
  if (grupo === 'salida') return 'Salida';
  return grupo;
}

export function getStockOrigenNombre(
  origenes: StockOrigenMovimiento[],
  rawGrupo: string
): string {
  const configGrupo = mapToConfigOrigenGrupo(rawGrupo);
  const match = origenes.find((item) => item.grupo === configGrupo);
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

const ORDER_STOCK_ESTADO_BY_ORIGEN: Record<string, string> = {
  pedido: 'Confirmado',
  pedido_reserva: 'Reserva',
  pedido_liberacion_reserva: 'Liberación reserva',
  pedido_produccion: 'En producción',
  pedido_listo: 'Listo',
  pedido_descuento: 'Descuento',
  pedido_cancelado: 'Cancelado',
  pedido_eliminado: 'Restauración',
  pedido_transferencia_reserva: 'Transferencia reserva',
};

export function formatOrderStockMotivo(orderLabel: string, estadoLabel: string): string {
  const digits = String(orderLabel ?? '').replace(/\D/g, '');
  const normalized = digits ? digits.padStart(5, '0') : String(orderLabel ?? '').trim();
  return `Pedido #${normalized} - ${estadoLabel}`;
}

function extractOrderLabelFromMotivo(motivo: string, fallback?: string | null): string | null {
  const fromHash = motivo.match(/#(\d{1,5})/)?.[1];
  if (fromHash) return fromHash.padStart(5, '0');
  const fromFallback = String(fallback ?? '').replace(/\D/g, '');
  return fromFallback ? fromFallback.padStart(5, '0') : null;
}

function parseLegacyOrderStockEstado(motivo: string): string | null {
  if (/^listo pedido/i.test(motivo)) return 'Listo';
  if (/^producción pedido/i.test(motivo)) return 'En producción';
  if (/^descuento pedido/i.test(motivo)) return 'Descuento';
  if (/^reserva pedido/i.test(motivo)) return 'Reserva';
  if (/liberación reserva pedido/i.test(motivo)) {
    return /cancelado/i.test(motivo) ? 'Cancelado' : 'Liberación reserva';
  }
  if (/^pedido #\d+ confirmado/i.test(motivo)) return 'Confirmado';
  if (/^pedido #\d+ cancelado/i.test(motivo)) return 'Cancelado';
  if (/^transferencia reserva/i.test(motivo)) return 'Transferencia reserva';

  const normalizedMatch = motivo.match(/^Pedido (#\d{5}) - (.+)$/i);
  if (normalizedMatch) return normalizedMatch[2].trim();

  return null;
}

/** Unifica motivos de pedido: «Pedido #00001 - Confirmado». */
export function normalizeOrderStockMotivo(
  rawMotivo: string,
  origenTipo?: string,
  numeroPedidoLabel?: string | null
): string {
  const motivo = String(rawMotivo ?? '').trim();
  if (!motivo) return '—';

  const already = motivo.match(/^Pedido (#\d{5}) - (.+)$/i);
  if (already) {
    return `Pedido ${already[1]} - ${already[2].trim()}`;
  }

  const label = extractOrderLabelFromMotivo(motivo, numeroPedidoLabel);
  if (label) {
    const legacyEstado = parseLegacyOrderStockEstado(motivo);
    if (legacyEstado) return formatOrderStockMotivo(label, legacyEstado);

    const origenEstado = origenTipo ? ORDER_STOCK_ESTADO_BY_ORIGEN[origenTipo] : undefined;
    if (origenEstado) return formatOrderStockMotivo(label, origenEstado);
  }

  return motivo;
}
