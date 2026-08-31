import type { LineItemAttributes } from './conversation-contract.ts';
import type { ConversationFocusEntities } from './conversation-state.ts';

export type QueryMetric = 'stock' | 'status' | 'balance' | 'details' | 'verify';

export type FocusProduct = {
  id?: string;
  name?: string;
  locked?: boolean;
  attributes?: LineItemAttributes;
};

export const ASK_STOCK_PRODUCT = '¿De qué producto querés consultar el stock?';

export function stockUnitLabel(qty: number): string {
  return Math.abs(qty) === 1 ? 'unidad' : 'unidades';
}

/** Presenter de consulta de stock. El número siempre viene del ERP. */
export function presentStockQuery(input: {
  productName: string;
  stock: number;
  expectedValue?: number;
}): string {
  const qty = Number(input.stock);
  const qtyText = `*${qty} ${stockUnitLabel(qty)}*`;
  if (input.expectedValue != null && Number.isFinite(input.expectedValue)) {
    if (input.expectedValue === qty) {
      return `Sí. El stock actual es ${qtyText}.`;
    }
    return `No. El stock actual es ${qtyText}.`;
  }
  const name = String(input.productName ?? '').trim() || 'Producto';
  return `*${name}*\nStock actual: ${qtyText}`;
}

function moneyList(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function presentOrderListItem(input: {
  label: string;
  date?: string;
  statusLabel?: string;
  total?: number;
}): string {
  const bits = [`#${input.label}`];
  if (input.date) bits.push(input.date);
  if (input.statusLabel) bits.push(input.statusLabel);
  if (input.total != null && Number.isFinite(input.total)) bits.push(`$${moneyList(input.total)}`);
  return `• ${bits.join(' · ')}`;
}

export function presentEntityList(input: {
  title: string;
  lines: string[];
  shown: number;
  total: number;
  hasMore: boolean;
  requestAll?: boolean;
  emptyText: string;
  footer?: string;
}): string {
  if (!input.lines.length) return input.emptyText;
  const parts = [`*${input.title}*`, '', ...input.lines];
  if (input.footer) {
    parts.push('', input.footer);
  }
  return parts.join('\n');
}

export function presentCountQuery(input: { subject: string; total: number; filterHint?: string }): string {
  const hint = input.filterHint ? ` ${input.filterHint}` : '';
  const noun = input.total === 1 ? 'pedido' : 'pedidos';
  return `${input.subject} tiene ${input.total} ${noun}${hint}.`;
}

export function presentOrderQuery(input: {
  metric?: QueryMetric | string | null;
  label: string;
  clientName?: string;
  statusLabel?: string;
  products?: string;
  notes?: string;
  total?: number;
  saldo?: number;
  delivery?: string;
}): string {
  const label = String(input.label ?? '').trim() || 'pedido';
  const metric = String(input.metric ?? 'details').trim().toLowerCase();
  if (metric === 'status') {
    return [`*Pedido #${label}*`, `Estado: *${input.statusLabel || 'sin estado'}*`].join('\n');
  }
  if (metric === 'balance') {
    const saldo =
      input.saldo != null && Number.isFinite(input.saldo)
        ? Number(input.saldo).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
        : '0';
    return [`*Pedido #${label}*`, `Saldo: *$${saldo}*`].join('\n');
  }
  const lines = [`*Pedido #${label}*`, ''];
  if (input.clientName) lines.push(`• Cliente: ${input.clientName}`);
  if (input.statusLabel) lines.push(`• Estado: ${input.statusLabel}`);
  if (input.products) lines.push(`• Producto: ${input.products}`);
  if (input.notes) lines.push(`• Descripción: ${input.notes}`);
  if (input.total != null && Number.isFinite(input.total)) {
    lines.push(
      `• Total: $${Number(input.total).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    );
  }
  if (input.saldo != null && Number.isFinite(input.saldo)) {
    lines.push(
      `• Saldo: $${Number(input.saldo).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    );
  }
  if (input.delivery) lines.push(`• Entrega: ${input.delivery}`);
  return lines.join('\n');
}

export function focusProductsFromOrderItems(items: unknown): FocusProduct[] {
  if (!Array.isArray(items)) return [];
  const out: FocusProduct[] = [];
  for (const row of items) {
    if (!row || typeof row !== 'object') continue;
    const data = row as Record<string, unknown>;
    const id = String(data.stockItemId ?? data.productoId ?? data.productId ?? '').trim();
    const name = String(data.nombre ?? data.productName ?? '').trim();
    if (!id && !name) continue;
    const color = String(data.color ?? '').trim();
    const size = String(data.talle ?? data.size ?? '').trim();
    out.push({
      id: id || undefined,
      name: name || undefined,
      locked: true,
      attributes: {
        color: color || null,
        size: size || null,
      },
    });
  }
  return out;
}

export function uniqueFocusProduct(products: FocusProduct[]): FocusProduct | undefined {
  if (products.length === 1) return products[0];
  const ids = [...new Set(products.map((row) => row.id).filter(Boolean))];
  if (ids.length === 1) return products.find((row) => row.id === ids[0]);
  return undefined;
}

export function focusedProductFromState(
  focusEntities?: ConversationFocusEntities | null
): FocusProduct | undefined {
  if (focusEntities?.product?.id || focusEntities?.product?.name) {
    return focusEntities.product;
  }
  return uniqueFocusProduct(focusEntities?.products ?? []);
}

export function attributesChanged(
  previous?: LineItemAttributes | null,
  incoming?: LineItemAttributes | null
): boolean {
  if (!incoming) return false;
  const keys: Array<keyof LineItemAttributes> = ['color', 'size', 'type', 'fabric', 'model', 'variant'];
  return keys.some((key) => {
    const next = String(incoming[key] ?? '').trim();
    if (!next) return false;
    const prev = String(previous?.[key] ?? '').trim();
    return next.toLowerCase() !== prev.toLowerCase();
  });
}
