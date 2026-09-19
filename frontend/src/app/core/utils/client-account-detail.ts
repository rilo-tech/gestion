import type { ClientAccountLineItem } from '../services/client.service';

export type ClientAccountDetailSource = {
  lineas?: ClientAccountLineItem[] | null;
  /** Descripción / concepto del comprobante (pedido.descripcion, etc.). */
  concepto?: string | null;
  /** Último recurso: Pedido #00226 / Venta #00239 */
  referencia?: string | null;
};

/**
 * Texto principal para columnas "Detalle" del estado de cuenta.
 * Prioridad: ítems reales → concepto/descripción → referencia del comprobante.
 * "Venta mostrador" / estados técnicos no ganan sobre un ítem.
 */
export function buildClientAccountDetail(source: ClientAccountDetailSource): {
  primary: string;
  /** Una línea por ítem (con cantidad si > 1), vacío si no hay lineas. */
  itemLines: string[];
} {
  const lineas = (source.lineas ?? []).filter((row) => String(row?.nombre ?? '').trim());
  const itemLines = lineas.map((row) => formatAccountLineLabel(row));
  const concepto = cleanAccountConcept(source.concepto);
  const referencia = String(source.referencia ?? '').trim();

  if (itemLines.length === 1) {
    return { primary: itemLines[0]!, itemLines };
  }
  if (itemLines.length > 1) {
    return { primary: itemLines.join('\n'), itemLines };
  }
  if (concepto) {
    return { primary: concepto, itemLines: [] };
  }
  return { primary: referencia || 'Comprobante', itemLines: [] };
}

export function formatAccountLineLabel(line: ClientAccountLineItem): string {
  const nombre = String(line.nombre ?? '').trim() || 'Ítem';
  const qty = Number(line.cantidad) || 0;
  if (qty > 1) return `${nombre} ×${qty}`;
  return nombre;
}

/** Conceptos genéricos / técnicos que no deben tapar un ítem real. */
const WEAK_CONCEPTS = new Set([
  'venta mostrador',
  'mostrador',
  'pedido',
  'listo',
  'en produccion',
  'en producción',
  'entregado',
  'pendiente',
  'cancelado',
]);

function cleanAccountConcept(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const folded = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (WEAK_CONCEPTS.has(folded)) return '';
  return raw;
}

export function formatAccountMoney(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  return (
    '$' +
    amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function formatAccountDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('es-AR');
}
