import {
  formatWhatsappResponse,
  formatTransactionSummary,
  waAskSiNo,
  waAskConfirmo,
  waBold,
  WA_PRESENT,
  type WhatsappView,
} from '../../shared/whatsapp-format.ts';
import type { WhatsappCommandEntities } from './ai-command-parser.ts';
import { catalogQueryForItem } from './conversation-contract.ts';
import { formatDateOnlyEs } from './lookups.ts';
import { formatOrderFinanceLines, formatOrderExtraCostLines, planRelatedOrderFinance } from './order-finance.ts';
import { traceOrderItems } from './conversation-log.ts';

function displayItemName(item: {
  quantity?: number;
  productName?: string;
  productHint?: string;
  rawText?: string;
  skipped?: boolean;
}): string | null {
  if (item.skipped) return null;
  const name = String(item.productName || item.productHint || item.rawText || '').trim() || '(sin detalle)';
  const qty = Number(item.quantity) || 1;
  return qty > 1 ? `• ${qty} ${name}` : `• ${name}`;
}

function notesLine(notes?: string): string | null {
  const raw = String(notes ?? '').trim();
  if (!raw) return null;
  const design = raw.match(/^(?:con\s+)?dise[nñ]o(?:\s+(?:que\s+(?:diga|dice)|de|es))?\s*:?\s*(.+)$/i);
  const value = (design?.[1] ?? raw).trim().replace(/^[a-z]/, (ch) => ch.toUpperCase());
  return `• Diseño: ${value}`;
}

function statusLine(entities: WhatsappCommandEntities): string | null {
  const requested = String(entities.requestedStatus ?? '').trim();
  if (!requested) return null;
  const labels: Record<string, string> = {
    listo: 'Listo',
    pendiente: 'Pendiente',
    entregado: 'Entregado',
    en_produccion: 'En proceso',
  };
  return `• Estado: ${labels[requested] || requested}`;
}

function compactOrderLines(
  entities: WhatsappCommandEntities,
  options?: { includeDelivery?: boolean }
): string[] {
  const lines: string[] = [];
  const items = (entities.items ?? [])
    .map((item) => displayItemName(item))
    .filter((line): line is string => Boolean(line));
  traceOrderItems('formatter', entities.items);
  if (items.length) lines.push(...items);
  else if (entities.productName) lines.push(`• ${entities.productName}`);
  const notes = notesLine(entities.notes);
  if (notes) lines.push(notes);
  const status = statusLine(entities);
  if (status) lines.push(status);
  if (options?.includeDelivery) {
    const entrega = formatDateOnlyEs(entities.deliveryDate).replace(/\/\d{4}$/, '');
    if (entrega) lines.push(`• Entrega: ${entrega}`);
  }
  const extras = (entities.extraCosts ?? []).filter(
    (item) => item.nombre?.trim() && Number(item.costo) > 0
  );
  const finance = planRelatedOrderFinance({
    amount: entities.amount,
    extraCosts: entities.extraCosts,
    collectionAmount: entities.collectionAmount,
    seniaAmount: entities.seniaAmount,
    paid: entities.paid,
    payFullBalance: entities.payFullBalance,
    sourceText: entities.sourceText,
  });
  for (const line of formatOrderFinanceLines(finance)) {
    lines.push(`• ${line}`);
  }
  for (const line of formatOrderExtraCostLines(extras)) {
    lines.push(`• ${line}`);
  }
  return lines;
}

export function presentOrderCollecting(entities: WhatsappCommandEntities, ask: string): string {
  const who = String(entities.clientName || entities.spokenClientName || '').trim();
  return formatTransactionSummary({
    title: who ? `Pedido a ${who}` : 'Pedido',
    lines: compactOrderLines(entities, { includeDelivery: Boolean(entities.deliveryDate) }),
    ask,
  });
}

export function presentOrderConfirm(entities: WhatsappCommandEntities): string {
  const who = String(entities.clientName || entities.spokenClientName || '').trim();
  return formatTransactionSummary({
    title: who ? `Pedido a ${who}` : 'Pedido',
    lines: compactOrderLines(entities, { includeDelivery: true }),
    ask: waAskConfirmo(),
  });
}

function itemLine(item: {
  quantity?: number;
  productName?: string;
  productHint?: string;
  rawText?: string;
  skipped?: boolean;
}): string | null {
  return displayItemName(item);
}

export function transactionViewFor(
  intent: string,
  entities: WhatsappCommandEntities,
  options?: { wantAll?: boolean }
): WhatsappView | null {
  if (intent !== 'create_order' && intent !== 'create_sale' && intent !== 'create_purchase') {
    return null;
  }
  const who =
    intent === 'create_purchase'
      ? String(entities.supplierName ?? '').trim()
      : String(entities.clientName ?? '').trim();
  const noun = intent === 'create_order' ? 'Pedido' : intent === 'create_sale' ? 'Venta' : 'Compra';
  const title = who ? `${noun} a ${who}` : noun;

  if (intent === 'create_order') {
    return {
      kind: 'transaction',
      title,
      items: compactOrderLines(entities, { includeDelivery: true }),
      question: waAskConfirmo(),
      wantAll: options?.wantAll || entities.listWantAll,
    };
  }

  const items =
    intent === 'create_purchase'
      ? (entities.purchaseLines ?? [])
          .filter((line) => !line.skipped)
          .map((line) => `• ${line.quantity} ${line.productName || line.invoiceName || '(ítem)'}`)
      : (entities.items ?? [])
          .map((item) => itemLine(item))
          .filter((line): line is string => Boolean(line));

  if (!items.length && entities.productName) {
    const qty = Number(entities.quantity) || 1;
    items.push(qty > 1 ? `• ${qty} ${entities.productName}` : `• ${entities.productName}`);
  }

  const footer: string[] = [];
  const qtyTotal = (entities.items ?? []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  if (intent !== 'create_purchase' && qtyTotal > 4) {
    footer.push(`*Total de prendas:* ${qtyTotal}`);
  }
  const finance = planRelatedOrderFinance({
    amount: entities.amount,
    extraCosts: entities.extraCosts,
    collectionAmount: entities.collectionAmount,
    seniaAmount: entities.seniaAmount,
    paid: entities.paid,
    payFullBalance: entities.payFullBalance,
    sourceText: entities.sourceText,
  });
  footer.push(...formatOrderFinanceLines(finance, { bold: true }));
  footer.push(...formatOrderExtraCostLines(entities.extraCosts, { bold: true }));

  return {
    kind: 'transaction',
    title,
    items,
    footer,
    question: waAskSiNo(),
    wantAll: options?.wantAll || entities.listWantAll,
  };
}

export function presentTransaction(
  intent: string,
  entities: WhatsappCommandEntities,
  options?: { wantAll?: boolean }
): string[] {
  if (intent === 'create_order') {
    const lines = compactOrderLines(entities, { includeDelivery: true });
    if (lines.length <= WA_PRESENT.transactionItemsPerPage) {
      return [presentOrderConfirm(entities)];
    }
  }
  const view = transactionViewFor(intent, entities, options);
  if (!view) return [];
  return formatWhatsappResponse(view).pages;
}

export function numberedOptionItems(labels: string[]): string[] {
  return labels.map((label, index) => `${index + 1}. ${label}`);
}

export function presentExploreList(input: {
  title: string;
  items: string[];
  wantAll?: boolean;
  question?: string;
}): ReturnType<typeof formatWhatsappResponse> {
  return formatWhatsappResponse({
    kind: 'explore',
    title: input.title,
    items: input.items,
    question: input.question,
    wantAll: input.wantAll,
  });
}

export function presentSimple(text: string, title?: string): string {
  if (!title) return String(text ?? '').trim();
  return [waBold(title), '', String(text ?? '').trim()].join('\n').trim();
}

export function progressLinesFromEntities(entities: WhatsappCommandEntities): string[] {
  return (entities.items ?? []).map((item) => {
    const label = item.productName || catalogQueryForItem(item) || item.rawText;
    const missing =
      !item.attributes?.color && !item.productId ? ' ⚠️ falta color' : '';
    return `• ${item.quantity} ${label}${item.productId ? ' ✅' : missing}`;
  });
}
