import type { WhatsappCommandEntities } from './ai-command-parser.ts';
import {
  extractAmountFromText,
  extractDeliveryDateFromText,
  formatClientChoices,
  formatExtraCostsHint,
  formatOperationSummary,
  formatProductChoices,
  formatSupplierChoices,
  formatPurchasePackChoices,
  formatPurchaseUnknownsPrompt,
  formatPurchaseNonCatalogChoices,
  formatPurchaseConfirmationMessages,
  isUnlikelyPersonName,
  looksLikeIterativeCorrection,
  looksLikeNewOrder,
  looksLikeStatusQuery,
} from './lookups.ts';
import { looksLikePendingQuestion } from './operator-voice.ts';
import { formatCashAmbitoChoices } from '../utils/caja-ambitos.ts';
import { riloBotHelpMenu } from '../../shared/whatsapp-copy.ts';
import { waBold, waCard } from '../../shared/whatsapp-format.ts';
import { looksLikeCashMovement, looksLikeOrphanPayment, looksLikeOrderStatusUpdate, looksLikeListOrders } from './ai-command-parser.ts';
import {
  formatFindOrderGuide,
  formatOpenOrderChoices,
  formatOrderActionAsk,
  formatSettleAsk,
  type OrderStatusTarget,
} from './order-status.ts';

const CONFIRM_YES = /^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i;
const CONFIRM_NO = /^(no+|n[oó]|nop|cancelar|cancel|n)\s*[.!]*$/i;
const CONFIRM_PREFIX = 'confirm:';

type PendingPayload = Record<string, unknown>;

function payloadEntities(payload: PendingPayload): WhatsappCommandEntities {
  if (payload.entities && typeof payload.entities === 'object' && !Array.isArray(payload.entities)) {
    return { ...(payload.entities as WhatsappCommandEntities) };
  }
  return { ...(payload as WhatsappCommandEntities) };
}

function missingFieldOf(payload: PendingPayload): string {
  return String(payload.missingField ?? '').trim();
}

export function waitingLabel(pendingIntent: string, payload: PendingPayload = {}): string {
  if (pendingIntent === 'select_client') return 'que elija el cliente de la lista (un número)';
  if (pendingIntent === 'select_product') return 'que elija el producto de la lista (un número)';
  if (pendingIntent === 'select_purchase_pack') return 'que elija cómo cargar el pack (1 o 2)';
  if (pendingIntent === 'select_purchase_unknowns') {
    return 'que elija un número para vincularlo o descartarlo';
  }
  if (pendingIntent === 'select_purchase_non_catalog') {
    return 'que elija descartar o cargarlo como gasto';
  }
  if (pendingIntent === 'select_supplier') return 'que elija el proveedor de la lista (un número)';
  if (pendingIntent === 'select_payment' || pendingIntent === 'select_card') {
    return 'que elija cómo paga';
  }
  if (pendingIntent === 'select_cash_ambito') {
    return 'que elija la caja (un número o el nombre: negocio, personal)';
  }
  if (pendingIntent === 'select_order') {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    return candidates.length
      ? 'que elija el pedido de la lista (un número)'
      : 'un dato para encontrar el pedido (cliente, producto, monto o número)';
  }
  if (pendingIntent === 'select_payment_kind') {
    return 'si es cobro de un pedido o un movimiento suelto de caja';
  }
  if (pendingIntent === 'order_action') {
    return 'qué hacer con el pedido (listo, saldalo o un monto)';
  }
  if (pendingIntent === 'settle_order') {
    return 'si cobra el saldo (SÍ, un monto, o NO)';
  }
  if (pendingIntent === 'help_topic') {
    return 'que elija un número del listado, o cómo hacer algo';
  }
  if (pendingIntent === 'confirm_create_client') return 'confirmar si crea el cliente (SÍ / NO)';
  if (pendingIntent === 'confirm_create_product') return 'confirmar si crea el producto (SÍ / NO)';
  if (pendingIntent === 'confirm_create_supplier') return 'confirmar si crea el proveedor (SÍ / NO)';
  if (pendingIntent === 'clarify') {
    const missing = missingFieldOf(payload);
    if (missing === 'deliveryDate') return 'la fecha de entrega (mañana, viernes, 28/08 o LISTO)';
    if (missing === 'notes') return 'la descripción del pedido, o LISTO';
    if (missing === 'client' || missing === 'clientName') return 'el nombre del cliente';
    if (missing === 'productName') return 'el producto';
    if (missing === 'amount') return 'el precio';
    return 'el dato que faltaba';
  }
  if (pendingIntent.startsWith(CONFIRM_PREFIX)) return 'confirmar si guarda (SÍ / NO)';
  return 'seguir con lo que estábamos haciendo';
}

export function reconstructPendingPrompt(
  pendingIntent: string,
  payload: PendingPayload
): string {
  const entities = payloadEntities(payload);
  const query = String(payload.query ?? '').trim();
  const allowCreate = payload.allowCreate !== false;
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];

  if (pendingIntent === 'select_client') {
    return formatClientChoices(
      candidates as Array<{ nombre: string }>,
      query || entities.clientName,
      { allowCreate }
    );
  }
  if (pendingIntent === 'select_supplier') {
    return formatSupplierChoices(candidates as Array<{ nombre: string }>, query, { allowCreate });
  }
  if (pendingIntent === 'select_product') {
    const lineIdx = Number(payload.lineIndex);
    const line =
      Number.isInteger(lineIdx) && lineIdx >= 0 ? entities.purchaseLines?.[lineIdx] : undefined;
    return formatProductChoices(
      candidates as Array<{ nombre: string; label?: string; precioVenta?: number }>,
      query || line?.invoiceName || entities.productName,
      {
        allowCreate,
        context: String(payload.originalIntent ?? '') === 'create_purchase' ? 'purchase' : 'order',
        lineIndex: Number.isInteger(lineIdx) ? lineIdx : undefined,
        lineCount: Array.isArray(entities.purchaseLines) ? entities.purchaseLines.length : undefined,
        unitCost: line ? Number(line.unitCost) || 0 : undefined,
        unitCostNet: line ? Number(line.unitCostNet) || undefined : undefined,
        quantity: line ? Number(line.quantity) || undefined : undefined,
        packUnits: line ? Number(line.packUnits) || undefined : undefined,
      }
    );
  }
  if (pendingIntent === 'select_purchase_unknowns') {
    return formatPurchaseUnknownsPrompt(entities, {
      followUp: entities.purchaseUnknownsAsked === true,
    });
  }
  if (pendingIntent === 'select_purchase_non_catalog') {
    const lineIdx = Number(payload.lineIndex);
    const line =
      Number.isInteger(lineIdx) && lineIdx >= 0 ? entities.purchaseLines?.[lineIdx] : undefined;
    return line
      ? formatPurchaseNonCatalogChoices(line)
      : '¿Lo descarto o lo cargo como gasto?';
  }
  if (pendingIntent === 'select_purchase_pack') {
    const lineIdx = Number(payload.lineIndex);
    const line =
      Number.isInteger(lineIdx) && lineIdx >= 0 ? entities.purchaseLines?.[lineIdx] : undefined;
    if (!line) return '¿Cómo cargo el pack? 1 = unidades sueltas · 2 = como el renglón.';
    return formatPurchasePackChoices(line, {
      lineIndex: lineIdx,
      lineCount: entities.purchaseLines?.length,
    });
  }
  if (pendingIntent === 'select_cash_ambito') {
    const ambitos = candidates.map((candidate) => {
      const row = candidate as { id?: string; nombre?: string; label?: string };
      return {
        id: String(row.id ?? ''),
        label: String(row.label || row.nombre || row.id || ''),
      };
    });
    return formatCashAmbitoChoices(ambitos, entities.cashType);
  }
  if (pendingIntent === 'select_order') {
    const orders = candidates as OrderStatusTarget[];
    const clientHint = String(entities.clientName ?? payload.query ?? '').trim();
    return orders.length
      ? formatOpenOrderChoices(orders, '¿Cuál? Número de la lista.\nDespués cobrás, lo asociás o lo marcás *listo*.')
      : formatFindOrderGuide({
          paymentAmount: Number(entities.amount) || undefined,
          triedHint: clientHint || undefined,
          forQuery: String(payload.originalIntent ?? '') === 'query_status',
        });
  }
  if (pendingIntent === 'select_payment_kind') {
    const amount = Number(entities.amount) || 0;
    return waCard({
      title: '¿Cómo lo registro?',
      lines: [
        amount > 0 ? `Tengo $${amount.toLocaleString('es-AR')}.` : 'Llegó plata.',
        '• *1* cobro de un pedido',
        '• *2* ingreso suelto de caja',
      ],
      ask: 'O decime el cliente / el producto. Si es un *egreso*, escribilo así.',
    });
  }
  if (pendingIntent === 'order_action') {
    const picked = payload.picked as OrderStatusTarget | undefined;
    if (picked?.id) return formatOrderActionAsk(picked);
    return '¿Lo marco listo, lo saldo, o cobro un monto?';
  }
  if (pendingIntent === 'settle_order') {
    const label = String(entities.targetOrderLabel ?? '').trim();
    const saldo = Number(entities.targetOrderSaldo) || 0;
    return formatSettleAsk(label, String(entities.clientName ?? ''), saldo);
  }
  if (pendingIntent === 'help_topic') {
    return riloBotHelpMenu();
  }
  if (pendingIntent === 'confirm_create_client') {
    const name = String(payload.proposedName ?? entities.clientName ?? query).trim();
    return waCard({
      title: 'Cliente nuevo',
      lines: [`No encontré *${name}*.`],
      ask: `${waBold('SÍ')} = lo registro y sigo\nOtro nombre = busco ese\n${waBold('NO')} = cancelar`,
    });
  }
  if (pendingIntent === 'confirm_create_product') {
    const name = String(payload.proposedName ?? entities.productName ?? query).trim();
    if (String(payload.originalIntent ?? '') === 'create_purchase') {
      return waCard({
        title: 'Este ítem',
        lines: [`No encontré *${name}* en el catálogo.`],
        ask:
          `${waBold('SÍ')} = crear (suma stock)\n` +
          `${waBold('INSUMO')} = gasto sin stock\n` +
          `${waBold('SALTAR')} · otro nombre = busco\n` +
          `${waBold('NO')} = cancelar todo`,
      });
    }
    const unit = Number(entities.amount) || 0;
    const priceHint = unit > 0 ? ` a $${unit}` : '';
    return waCard({
      title: 'Producto nuevo',
      lines: [
        `No encontré *${name}* en el catálogo.`,
        'Si lo creo, queda para pedidos/ventas (sin control de stock).',
      ],
      ask: `${waBold('SÍ')} = crear y usar${priceHint}\nOtro nombre = busco ese\n${waBold('NO')} = cancelar`,
    });
  }
  if (pendingIntent === 'confirm_create_supplier') {
    const name = String(payload.proposedName ?? entities.supplierName ?? query).trim();
    return waCard({
      title: 'Proveedor nuevo',
      lines: [`No encontré *${name}*.`],
      ask: `${waBold('SÍ')} = lo registro y sigo\nOtro nombre · ${waBold('NO')} = cancelar`,
    });
  }
  if (pendingIntent === 'clarify') {
    const missing = missingFieldOf(payload);
    if (missing === 'deliveryDate') {
      const extra = formatExtraCostsHint(entities);
      return waCard({
        title: 'Fecha de entrega',
        lines: extra ? [`Tengo ${extra}.`] : undefined,
        ask: `Ej: mañana, viernes, 28/08.\n${waBold('LISTO')} = la dejo para hoy.`,
      });
    }
    if (missing === 'notes') {
      return waCard({
        title: 'Descripción',
        lines: ['Ubicación del estampado, frase, observaciones.'],
        ask: `${waBold('LISTO')} = sin descripción.`,
      });
    }
    return waCard({
      title: 'Seguimos',
      ask: `Pasame lo que te pedí, o ${waBold('NO')} para cancelar.`,
    });
  }
  if (pendingIntent.startsWith(CONFIRM_PREFIX)) {
    const intent = pendingIntent.slice(CONFIRM_PREFIX.length);
    if (intent === 'create_purchase') {
      const pages = formatPurchaseConfirmationMessages(entities);
      return pages[pages.length - 1] ?? formatOperationSummary(intent, entities);
    }
    return formatOperationSummary(intent, entities);
  }
  return 'Seguimos con lo de antes. Pasame el número, SÍ/NO, o lo que te pedí.';
}

/** Guarda fecha/precio si los tiró al pasar, sin cambiar de paso. */
export function stashAsideFacts(
  text: string,
  entities: WhatsappCommandEntities
): WhatsappCommandEntities {
  const next = { ...entities };
  if (!next.deliveryDate) {
    const delivery = extractDeliveryDateFromText(text);
    if (delivery) {
      next.deliveryDate = delivery;
      next.deliveryAsked = true;
      next.deliveryDefaulted = undefined;
    }
  }
  if (next.amount == null && !looksLikeCashMovement(text)) {
    const amount = extractAmountFromText(text);
    if (amount != null) next.amount = amount;
  }
  return next;
}

export function mergeStashIntoPayload(payload: PendingPayload, text: string): PendingPayload {
  const next = { ...payload };
  if (next.entities && typeof next.entities === 'object' && !Array.isArray(next.entities)) {
    next.entities = stashAsideFacts(text, { ...(next.entities as WhatsappCommandEntities) });
    return next;
  }
  return stashAsideFacts(text, next as WhatsappCommandEntities) as PendingPayload;
}

function isDateOnlyUtterance(text: string): boolean {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 4) return false;
  return Boolean(extractDeliveryDateFromText(t));
}

/** El mensaje resuelve el paso actual (número, SÍ/NO, fecha, nombre). Si no, hay que volver al contexto. */
export function doesFillCurrentSlot(
  text: string,
  pendingIntent: string,
  payload: PendingPayload
): boolean {
  const t = String(text ?? '').trim();
  if (!t || !pendingIntent) return true;
  if (CONFIRM_NO.test(t) || /^cancelar$/i.test(t)) return true;
  if (looksLikePendingQuestion(t)) return false;
  if (looksLikeIterativeCorrection(t)) return true;

  if (/^\d{1,2}$/.test(t)) return true;
  if (/^(crear|nuevo)$/i.test(t)) return true;

  const missing = missingFieldOf(payload);

  if (pendingIntent === 'clarify' && missing === 'deliveryDate') {
    if (/^(listo|nada|sin fecha|sin fecha de entrega|despu[eé]s|despues|ahora no|-)$/i.test(t)) {
      return true;
    }
    return Boolean(extractDeliveryDateFromText(t));
  }

  if (pendingIntent === 'clarify' && missing === 'notes') {
    return true;
  }

  if (pendingIntent === 'select_client' || pendingIntent === 'select_supplier') {
    if (isDateOnlyUtterance(t) || isUnlikelyPersonName(t)) return false;
    return t.length >= 2 && t.length <= 80;
  }

  if (pendingIntent === 'select_product') {
    if (isDateOnlyUtterance(t)) return false;
    return t.length >= 2;
  }

  if (pendingIntent === 'select_purchase_unknowns') {
    if (looksLikePendingQuestion(t)) return false;
    return t.length >= 1;
  }

  if (pendingIntent === 'select_purchase_non_catalog') {
    if (looksLikePendingQuestion(t)) return false;
    return /^(1|2|descartar|saltar|omitir|insumo|gasto|sacar|sacalo|sacálo)$/i.test(t) || t.length <= 40;
  }

  if (pendingIntent === 'select_purchase_pack') {
    if (looksLikePendingQuestion(t)) return false;
    return /^(1|2|3|4|pack|rengl[oó]n|linea|línea|insumo|herramienta|saltar)$/i.test(t) || t.length <= 40;
  }

  if (
    pendingIntent === 'confirm_create_client' ||
    pendingIntent === 'confirm_create_product' ||
    pendingIntent === 'confirm_create_supplier'
  ) {
    return CONFIRM_YES.test(t) || t.length >= 2;
  }

  if (pendingIntent.startsWith(CONFIRM_PREFIX)) {
    return CONFIRM_YES.test(t);
  }

  if (pendingIntent === 'select_payment' || pendingIntent === 'select_card') {
    return t.length >= 1;
  }

  if (pendingIntent === 'select_cash_ambito') {
    if (looksLikePendingQuestion(t)) return false;
    return /^\d{1,2}$/.test(t) || (t.length >= 2 && t.length <= 80);
  }

  if (pendingIntent === 'select_order') {
    if (looksLikePendingQuestion(t) || looksLikeNewOrder(t)) return false;
    return (
      /^\d{1,2}\b/.test(t) ||
      /#?\d{3,}/.test(t) ||
      /(?<![\p{L}])(listo|sald|pag[oó]|cobr)(?![\p{L}])/iu.test(t) ||
      (t.length >= 2 && t.length <= 80)
    );
  }

  if (pendingIntent === 'select_payment_kind') {
    if (looksLikePendingQuestion(t)) return false;
    return t.length >= 1;
  }

  if (pendingIntent === 'order_action' || pendingIntent === 'settle_order') {
    if (looksLikePendingQuestion(t) || looksLikeNewOrder(t)) return false;
    return (
      CONFIRM_YES.test(t) ||
      CONFIRM_NO.test(t) ||
      /(?<![\p{L}])(listo|pronto|termin|sald|pag[oó]|cobr|se[nñ]a|despu[eé]s)(?![\p{L}])/iu.test(t) ||
      Boolean(extractAmountFromText(t)) ||
      /^\d/.test(t)
    );
  }

  if (pendingIntent === 'help_topic') {
    return true;
  }

  return true;
}

const CASH_QUERY_FRESH =
  /\b(cu[aá]nto\s+(hay\s+)?en\s+caja|caja\s+(de\s+)?hoy|saldo\s+neto|cu[aá]nto\s+vend[ií])\b/i;
const PURCHASE_FRESH = /\b(compra|remito|factura)\s+(a|de|del)\b/i;

/**
 * El último mensaje es otra operación (egreso, pedido nuevo, compra), no una
 * respuesta al paso pendiente. Hay que soltar el contexto anterior.
 */
export function isFreshTaskUtterance(text: string, pendingIntent: string): boolean {
  const t = String(text ?? '').trim();
  if (!t || !pendingIntent) return false;
  if (/^\d{1,2}$/.test(t)) return false;
  if (/^(si|sí|ok|dale|confirmo|yes|y|no+|nop|cancelar|n)$/i.test(t)) return false;
  if (pendingIntent === 'select_cash_ambito') return false;
  if (looksLikeCashMovement(t)) return true;
  if (looksLikeOrderStatusUpdate(t)) return true;
  if (looksLikeListOrders(t) || looksLikeStatusQuery(t)) return true;
  if (CASH_QUERY_FRESH.test(t)) return true;
  if (PURCHASE_FRESH.test(t) && !/\bpedido\b/i.test(t)) return true;
  if (
    looksLikeOrphanPayment(t) &&
    pendingIntent !== 'select_order' &&
    pendingIntent !== 'select_payment_kind' &&
    pendingIntent !== 'order_action' &&
    pendingIntent !== 'settle_order'
  ) {
    return true;
  }
  if (
    looksLikeNewOrder(t) &&
    (pendingIntent === 'select_order' ||
      pendingIntent === 'select_payment_kind' ||
      pendingIntent === 'order_action' ||
      pendingIntent === 'settle_order')
  ) {
    return true;
  }
  return false;
}
