import type { LineItemAttributes } from './conversation-contract.ts';
import type { ConversationFocusEntities } from './conversation-state.ts';
import { compactWhatsappText, waBold } from '../../shared/whatsapp-format.ts';
import {
  ensureSingleListAsk,
  waListActionAsk,
  type WaListAskEntity,
} from '../../shared/whatsapp-visual.ts';

/** Frase centralizada al pie de listados seleccionables / accionables. */
export function ensureListActionAsk(text: string, entity?: WaListAskEntity): string {
  return ensureSingleListAsk(text, entity);
}

export function listActionAskForEntity(entity: WaListAskEntity): string {
  return waListActionAsk(entity);
}

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

export type OrderLineItemView = {
  name: string;
  quantity?: number;
};

/** Extrae renglones de ítems desde el documento ERP / tool output. */
export function orderLineItemsFromErp(items: unknown): OrderLineItemView[] {
  if (!Array.isArray(items) || !items.length) return [];
  const out: OrderLineItemView[] = [];
  for (const row of items) {
    if (!row || typeof row !== 'object') continue;
    const data = row as Record<string, unknown>;
    const name = String(
      data.nombre ?? data.productName ?? data.name ?? data.descripcion ?? data.label ?? ''
    ).trim();
    if (!name) continue;
    const quantity = Number(data.cantidad ?? data.quantity) || undefined;
    out.push({ name, quantity: quantity && quantity > 0 ? quantity : undefined });
  }
  return out;
}

export function formatOrderLineItem(item: OrderLineItemView): string {
  const qty = item.quantity && item.quantity > 1 ? `${item.quantity} × ` : '';
  return `${qty}${item.name}`;
}

export function formatOrderItemsSummary(items: OrderLineItemView[]): string {
  return items.map(formatOrderLineItem).join(', ');
}

export function presentOrderItemLines(items: OrderLineItemView[]): string[] {
  return items.map((item) => `• ${formatOrderLineItem(item)}`);
}

export function presentOrderListItem(input: {
  label: string;
  date?: string;
  statusLabel?: string;
  total?: number;
  balance?: number;
  products?: string;
  items?: OrderLineItemView[];
  detail?: boolean;
}): string {
  const lineItems =
    input.items?.length ? input.items : undefined;
  if (input.detail) {
    const headerBits = [`#${input.label}`];
    if (input.statusLabel) headerBits.push(input.statusLabel);
    const lines = [`*${headerBits.join(' – ')}*`];
    if (lineItems?.length) {
      lines.push(...presentOrderItemLines(lineItems));
    } else if (input.products) {
      lines.push(`• ${input.products}`);
    }
    if (input.date) lines.push(`Entrega: ${input.date}`);
    const moneyBits: string[] = [];
    if (input.total != null && Number.isFinite(input.total)) {
      moneyBits.push(`Total: $${moneyList(input.total)}`);
    }
    if (input.balance != null && Number.isFinite(input.balance)) {
      moneyBits.push(`Pendiente: $${moneyList(input.balance)}`);
    }
    if (moneyBits.length) lines.push(moneyBits.join(' · '));
    return lines.join('\n');
  }
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
  /** Si false, no agrega la invitación de acción (p.ej. listados informativos de movimientos). Default true. */
  inviteAction?: boolean;
}): string {
  if (!input.lines.length) return input.emptyText;
  const entity = detectEntityFromTitle(input.title);
  const body = compactWhatsappText(
    [
      `*${String(input.title).replace(/\*/g, '').trim()}*`,
      '',
      ...input.lines,
      ...(input.footer ? ['', input.footer] : []),
    ].join('\n')
  );
  if (input.inviteAction === false) return body;
  return ensureListActionAsk(body, entity);
}

function detectEntityFromTitle(title: string): WaListAskEntity {
  const t = String(title ?? '');
  if (/producto/i.test(t) || /📦/.test(t)) return 'product';
  if (/cliente/i.test(t) || /👥/.test(t)) return 'client';
  if (/proveedor/i.test(t) || /🚚/.test(t)) return 'supplier';
  return 'generic';
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
  items?: OrderLineItemView[];
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
  const lineItems = input.items?.length ? input.items : undefined;
  if (lineItems?.length) {
    lines.push(...presentOrderItemLines(lineItems));
  } else if (input.products) {
    lines.push(`• Producto: ${input.products}`);
  }
  if (input.notes) lines.push(`• Descripción: ${input.notes}`);
  if (input.total != null && Number.isFinite(input.total)) {
    lines.push(
      `• Total: ${waBold(`$${Number(input.total).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`)}`
    );
  }
  if (input.saldo != null && Number.isFinite(input.saldo)) {
    lines.push(
      `• Saldo: ${waBold(`$${Number(input.saldo).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`)}`
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
