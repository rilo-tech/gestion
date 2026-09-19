import {
  extractAmountFromText,
  extractSeniaFromText,
  extractClientHintFromText,
  extractRegisterClientFromText,
  extractDeliveryDateFromText,
  extractOrderDateFromText,
  extractNotesHintFromText,
  extractProductHintFromText,
  extractQueryClientFromText,
  coerceDateOnly,
  isUnlikelyPersonName,
  extractSpokenCorrections,
  extractOrderNumberFromText,
  looksLikeNewOrder,
  looksLikeClientCorrection,
  looksLikeProductCorrection,
  looksLikeCollectFullBalance,
  looksLikeExistingOrderQuery,
  looksLikeStatusQuery,
  extractExtraCostsFromText,
  extractExtraCostProductHint,
  mergeExtraCostItems,
  sanitizeOrderNotes,
  looksLikeClearExtraCosts,
  looksLikePayEverythingNow,
  parseInvoiceMoney,
  grossUpPurchaseLinesIfVatSeparated,
  inferPurchasePackUnits,
  extractCatalogCostUpdate,
  type ExtraCostItem,
} from './lookups.ts';
import { parsePersonNameAndPhone } from './client-identity.ts';
import {
  applyCompletePartyFromUtterance,
  preferCompleteEntityName,
} from './entity-name.ts';
import { looksLikeRelatedOrderPayment } from './order-finance.ts';
import { formatOperatorMemoryPrompt, loadOperatorMemory } from './operator-memory.ts';
import { assertCanUseAi, incrementAiUsage } from '../auth/usage-gates.ts';
import {
  interpretStockResolutionFromText,
  isStockResolutionPending,
  scopeFromStockResolution,
  STOCK_RESOLUTION_INTENT,
} from './stock-resolution.ts';
import { whatsappCopyForRubro } from './copy.ts';
import { isTrivialWhatsappTurn } from './operator-voice.ts';
import { generateGeminiJson } from './gemini.ts';
import {
  followUpToConversationAction,
  GEMINI_TURN_SCHEMA,
  isValidTurnJson,
  parseConversationAction,
  parseLineItems,
  splitConcatenatedProductText,
  type ConversationAction,
  type LineItemIntent,
} from './conversation-contract.ts';
import { formatLanguageMemoryPrompt, type UserLanguageMemory } from './language-memory.ts';
import { applyFollowUpToEntities, ensureOrderItems, extractSpokenColor, extractSpokenSize, syncLegacyProductFields, coalesceOrderItems } from './turn-interpreter.ts';
import { traceOrderItems } from './conversation-log.ts';
import { applyOrderLock, lockedOrderFromFocus } from './order-lock.ts';
import {
  expectedItemCountFromText,
  howToTopicFromText,
  isNonProductUtterance,
  isPlaceholderProductLabel,
  PRODUCT_INTENTS,
  utteranceIsCapabilityQuestion,
  utteranceIsHowTo,
} from './conversation-speech.ts';

export type WhatsappIntent =
  | 'help'
  | 'how_to'
  | 'capability_question'
  | 'greeting'
  | 'create_order'
  | 'create_sale'
  | 'create_purchase'
  | 'register_payment'
  | 'query_balance'
  | 'query_cash'
  | 'query_status'
  | 'query_stock'
  | 'register_cash'
  | 'create_client'
  | 'register_cost'
  | 'update_product_cost'
  | 'update_order_status'
  | 'unknown'
  | 'interpreter_unavailable';

export type WhatsappPurchaseLine = {
  productName: string;
  /** Nombre tal cual en la factura; se memoriza al vincularlo al catálogo. */
  invoiceName?: string;
  productId?: string;
  quantity: number;
  /** Costo unitario CON IVA (el que entra a la compra). */
  unitCost: number;
  /** Precio unitario NETO de la boleta, antes de IVA. */
  unitCostNet?: number;
  /** Si la descripción trae x2 / pack: unidades por renglón. */
  packUnits?: number;
  packResolved?: boolean;
  /** No entra en la compra (ni stock ni importe). */
  skipped?: boolean;
  /** stock = suma inventario; insumo = gasto/herramienta, no mueve stock. */
  tipoLinea?: 'stock' | 'insumo';
};

export type WhatsappCommandEntities = {
  clientId?: string;
  clientName?: string;
  /** Cómo lo nombró el usuario (apodo); se memoriza al confirmar. */
  spokenClientName?: string;
  /** Cliente ya resuelto: no sustituir salvo corrección explícita. */
  clientLocked?: boolean;
  /** Teléfono opcional al dar de alta un cliente por WhatsApp. */
  clientPhone?: string;
  productId?: string;
  productName?: string;
  spokenProductName?: string;
  quantity?: number;
  amount?: number;
  notes?: string;
  paid?: boolean;
  mediaId?: string;
  imageSummary?: string;
  /** Movimiento de caja manual. */
  cashType?: 'ingreso' | 'egreso';
  cashConcept?: string;
  /** Ámbito de caja (negocio, personal, …). */
  cashAmbitoId?: string;
  cashAmbitoLabel?: string;
  /** Cómo nombró la caja: «en personal», «la mía». */
  cashAmbitoHint?: string;
  /** No buscar/crear producto: usar productName como concepto libre. */
  productAsConcept?: boolean;
  /** El usuario ya respondió la descripción del pedido (aunque la deje vacía). */
  notesAsked?: boolean;
  /** El usuario ya respondió la fecha de entrega (aunque la deje vacía). */
  deliveryAsked?: boolean;
  /** true si la fecha de entrega se rellenó con hoy porque no la pasó. */
  deliveryDefaulted?: boolean;
  /** Fecha de carga YYYY-MM-DD. */
  orderDate?: string;
  /** Fecha de entrega del pedido YYYY-MM-DD. */
  deliveryDate?: string;
  /** Mensajes de esta operación, para no perder producto/notas del primer texto. */
  sourceText?: string;
  /** Texto original del usuario, inmutable. Nunca reconstruir semántica desde acá. */
  rawUserMessage?: string;
  supplierId?: string;
  supplierName?: string;
  invoiceNumber?: string;
  purchaseLines?: WhatsappPurchaseLine[];
  /** Ya se mostró el resumen de lectura de la boleta en este turno. */
  purchaseDigestShown?: boolean;
  /** Ya se listaron los ítems no reconocidos (el próximo listado es seguimiento). */
  purchaseUnknownsAsked?: boolean;
  /** Medio de pago de la compra (ids del ERP: efectivo, transferencia, …). */
  paymentMedioId?: string;
  paymentMedioLabel?: string;
  paymentTarjetaId?: string;
  paymentTarjetaLabel?: string;
  paymentCuotas?: number;
  paymentDueDate?: string;
  paymentHint?: string;
  documentNetTotal?: number;
  documentTaxTotal?: number;
  documentGrossTotal?: number;
  priceTaxMode?: 'net' | 'gross' | 'unknown';
  documentTaxRate?: number;
  /** Caja / ámbito de egreso inmediato (efectivo/transferencia). */
  cashAccountId?: string;
  /** Seña (primer pago de un pedido) o cobro suelto. */
  paymentKind?: 'senia' | 'pago';
  /** Seña que dejó junto con el pedido, para cobrarla al guardarlo. */
  seniaAmount?: number;
  /** Monto de cobro informado (no sube si después se agrega un extra). */
  collectionAmount?: number;
  /** Listar pedidos abiertos (el dueño no recuerda cuál). */
  listOrders?: boolean;
  /** Cobrar todo el saldo pendiente («ya pagó», «pagó el resto», «saldalo»). */
  payFullBalance?: boolean;
  /** Nuevo estado del pedido cuando el dueño avisa que avanzó. */
  orderStatus?: 'pendiente' | 'en_produccion' | 'listo' | 'entregado';
  /** Estado pedido explícitamente al crear («ponelo listo»). Nunca se infiere del pago. */
  requestedStatus?: 'pendiente' | 'en_produccion' | 'listo' | 'entregado';
  extraCostsEnabled?: boolean;
  extraCostsAsked?: boolean;
  extraCostsNotice?: string;
  /** A qué ítem cuelga el costo extra cuando hay varios renglones. */
  extraCostsProductHint?: string;
  extraCostsTargetItemIndex?: number;
  /** Datos del pedido apuntado, para mostrarlos antes de confirmar. */
  targetOrderSaldo?: number;
  helpTopic?: string;
  expectedItemCount?: number;
  collectingItems?: boolean;
  targetOrderSaldo?: number;
  targetOrderEstadoLabel?: string;
  orderStatusLabel?: string;
  orderStockWillDrop?: boolean;
  orderStockAlreadyDropped?: boolean;
  orderHasStockLines?: boolean;
  orderStatusUnchanged?: boolean;
  /** Alcance de descuento físico elegido (mismas claves que el panel). */
  descuentoFisicoAlcance?: 'solo_reservado' | 'pedido_completo';
  /** Respuesta a awaiting stock_resolution. */
  stockResolution?: 'discount_full_order' | 'discount_reserved' | 'cancel';
  /** Costos extra del pedido (estampado, vinilo) para el cálculo de ganancia. */
  extraCosts?: ExtraCostItem[];
  targetOrderId?: string;
  targetOrderLabel?: string;
  /** Número de pedido que nombró el dueño («#00223», «el 223»). */
  orderNumber?: string;
  /** Consulta sobre lo último que se guardó. */
  referToLast?: boolean;
  /** Consulta el producto actualmente enfocado (EntityResolver, no el raw). */
  referToFocusedProduct?: boolean;
  /** Métrica de una consulta: stock, estado, saldo o detalle. */
  queryMetric?: 'stock' | 'status' | 'balance' | 'details' | 'verify' | 'list' | 'count';
  queryEntity?: string;
  queryLimit?: number;
  queryRequestAll?: boolean;
  queryOffset?: number;
  queryPage?: 'next' | 'first' | string;
  queryStatusFilter?: string;
  queryDateFrom?: string;
  queryDateTo?: string;
  queryDateToken?: string;
  queryDateField?: 'createdAt' | 'fechaEntrega';
  querySortDir?: 'asc' | 'desc';
  /** Valor que el dueño quiere verificar («quedó en -1?»). Lo confirma el ERP. */
  queryExpectedValue?: number;
  saveAsDraft?: boolean;
  paymentIncompleteReason?: string;
  /** Ítems independientes del pedido/venta (contrato principal multi-renglón). */
  items?: LineItemIntent[];
  conversationAction?: ConversationAction;
  /** llm_first: comando tipado. sourceText no es semántica. */
  /** Idempotencia de write (p. ej. wa:{messageId} del webhook de Meta). */
  idempotencyKey?: string;
  semanticCommand?: import('./semantic-command.ts').SemanticCommand;
  requestedCapability?: string;
  capabilityUnwired?: boolean;
  /** El dueño pidió el listado completo («mostrame todos»). */
  listWantAll?: boolean;
};

export type WhatsappFollowUpAction = 'continue' | 'choose' | 'confirm' | 'cancel' | 'new' | 'ask' | 'correct';

export type ParsedWhatsappCommand =
  | {
      intent: 'help';
      confidence: number;
      raw?: string;
      followUpAction?: WhatsappFollowUpAction;
      choiceIndex?: number;
      choiceIndexes?: number[];
      conversationAction?: ConversationAction;
    }
  | {
      intent: 'greeting';
      confidence: number;
      followUpAction?: WhatsappFollowUpAction;
      choiceIndex?: number;
      choiceIndexes?: number[];
      conversationAction?: ConversationAction;
    }
  | {
      intent: Exclude<WhatsappIntent, 'help' | 'greeting'>;
      confidence: number;
      entities?: WhatsappCommandEntities;
      raw: string;
      followUpAction?: WhatsappFollowUpAction;
      choiceIndex?: number;
      choiceIndexes?: number[];
      conversationAction?: ConversationAction;
    };

export type WhatsappParseConversation = {
  originalIntent?: string;
  pendingIntent?: string;
  awaiting?: string;
  knownEntities?: WhatsappCommandEntities;
  missingKeys?: string[];
  candidates?: Array<{ index: number; label: string }>;
  lastOperation?: { kind?: string; id?: string; label?: string; clientName?: string; status?: string } | null;
  /** Pedido del que están hablando AHORA (lista, resumen, confirmación). */
  focusOrder?: { id?: string; label?: string; clientName?: string; status?: string } | null;
  focusEntities?: import('./conversation-state.ts').ConversationFocusEntities | null;
  lastQuery?: import('./conversation-state.ts').ConversationLastQuery | null;
  pendingPrompt?: string | null;
  turns?: Array<{ role?: string; text?: string }> | null;
  languageMemory?: UserLanguageMemory | null;
};

export type WhatsappParseInput = {
  text: string;
  image?: { buffer: Buffer; contentType: string } | null;
  audio?: { buffer: Buffer; contentType: string } | null;
  mediaId?: string | null;
  rubro?: string | null;
  businessId?: string;
  conversation?: WhatsappParseConversation;
};

const FOLLOW_UP_ACTIONS: WhatsappFollowUpAction[] = [
  'continue',
  'choose',
  'confirm',
  'cancel',
  'new',
  'ask',
  'correct',
];
const ORDER_PATTERNS = /\b(pedido|orden)\b/i;
const SALE_PATTERNS = /\b(venta|vend[ií])\b/i;
const PURCHASE_PATTERNS =
  /\b(compra|compr[eé]|remito|factura\s+(de\s+)?compra|proveedor|lleg[oó]\s+(la\s+)?mercader[ií]a)\b/i;
const PAYMENT_PATTERNS =
  /\b(pago|pagu[eé]|pag[oó]|cobra(?:r)?|cobr[eéoó]|abon[oóaáeé]|se[ñn]a|se[ñn][oó]|adelanto|anticipo|a\s+cuenta)\b/i;
/** Seña / adelanto: el primer pago va contra un pedido puntual. */
const SENIA_PATTERNS = /\b(se[ñn]a|se[ñn][oó]|adelanto|anticipo|a\s+cuenta)\b/i;
/** El mensaje arranca hablando de un cobro: «cobré…», «me pagó…», «abonó…». */
const PAYMENT_LEAD_PATTERNS = /^\s*(ya\s+)?(me\s+|te\s+|le\s+)?(cobr|pag|abon)/i;
// Los límites van con \p{L} porque \b no corta bien contra vocales acentuadas («entregué»).
/** Pagó todo lo que debía, sin decir el monto. */
const PAY_FULL_PATTERNS =
  /(?<![\p{L}])(pag[oó]\s+(todo|el\s+resto|lo\s+que\s+faltaba|completo)|(ya|me)\s+pag[oó](?![\p{L}])(?!\s*\$?\s*\d)|abon[oó]\s+(todo|el\s+resto)|qued[oó]\s+saldado|sald(?:alo|ar)(?!\s+de)|saldo\s+cero|est[aá]\s+(todo\s+)?pago|cobra(?:r)?\s+(?:todo\s+)?(?:el\s+)?(?:saldo|total|resto)|todo\s+el\s+saldo)/iu;
const SETTLE_BALANCE_PATTERNS =
  /(?<![\p{L}])(sald(?:alo|ar)(?!\s+de)|pago\s+del\s+total(?:\s+del\s+saldo)?|total\s+del\s+saldo|cobra(?:r)?\s+(?:todo\s+)?(?:el\s+)?(?:saldo|total|resto)|cobr[aeéoó]\s+todo(?!\s*\$?\s*\d)|todo\s+el\s+saldo|el\s+saldo\s+(?:entero|completo)|registr[aeá]\s+(?:el\s+)?pago(?:\s+del\s+(?:total|saldo))?)/iu;
/** El dueño avisa que el pedido avanzó de estado. */
const ORDER_STATUS_PATTERNS =
  /(?<![\p{L}])(qued[oó]\s+(listo|pronto|terminad[oa])|ya\s+est[aá]\s+(listo|pronto|terminad[oa]|pronta)|est[aá]\s+listo|(lo\s+)?termin[eé]|termin[eé]\s+(el\s+|ese\s+)?pedido|marc(?:[aá]|alo|amelo)|cambi(?:alo|[áa]lo|arlo)|p[aá]s(?:[aá]|alo|amelo)\s+(?:el\s+|ese\s+|este\s+)?(?:pedido\s+)?a\s+\w+|p[oó]n(?:[eé]lo|elo|[eé])\s+(en|como)\s+\w+|entregu[eé]|entregad[oa]|se\s+lo\s+(di|entregu[eé]|llev[oó])|ya\s+lo\s+(retir[oó]|llev[oó]|busc[oó])|lo\s+(retir[oó]|llev[oó])|en\s+producci[oó]n|empec[eé]\s+(a\s+hacer|el\s+pedido)|lo\s+estoy\s+haciendo)(?![\p{L}])/iu;
const STATUS_DELIVERED_PATTERNS =
  /(?<![\p{L}])(entregu[eé]|entregad[oa]|se\s+lo\s+(di|llev[oó])|(retir|llev|busc)[oó])(?![\p{L}])/iu;
const STATUS_PRODUCTION_PATTERNS =
  /(?<![\p{L}])(producci[oó]n|empec[eé]|haciendo|en\s+proceso)(?![\p{L}])/iu;

function parseOrderStatus(
  raw: unknown
): 'pendiente' | 'en_produccion' | 'listo' | 'entregado' | undefined {
  const value = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!value) return undefined;
  if (value.includes('entregad')) return 'entregado';
  if (value.includes('produccion') || value.includes('producción') || value.includes('proceso')) {
    return 'en_produccion';
  }
  if (value.includes('listo') || value.includes('pronto') || value.includes('terminad')) {
    return 'listo';
  }
  if (value.includes('pendiente')) return 'pendiente';
  return undefined;
}

/**
 * Estado pedido con un verbo de cambio (ponelo / pasalo / dejalo / marcalo).
 * «ya está pago» no es un estado.
 */
export function extractExplicitRequestedStatus(
  text: string
): 'pendiente' | 'en_produccion' | 'listo' | 'entregado' | undefined {
  const match = String(text ?? '').match(
    /(?<![\p{L}])(?:pon(?:[eé])?lo|pasalo|dejalo|marcalo|cambialo|poneme|move|movelo|mover)\s+(?:el\s+pedido\s+)?(?:en\s+|a\s+|como\s+)?(?:estado\s+)?(listo|pendiente|entregad[oa]|pronto|terminad[oa]|en\s+producci[oó]n|en\s+proceso)(?![\p{L}])/iu
  );
  return parseOrderStatus(match?.[1]);
}

function moneyAmount(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function applyCreateOrderPaymentAndStatus(next: WhatsappCommandEntities, text: string): void {
  const requested = extractExplicitRequestedStatus(text) || next.requestedStatus;
  if (requested) {
    next.requestedStatus = requested;
    next.orderStatus = requested;
  } else if (looksLikeNewOrder(text) || looksLikeRelatedOrderPayment(text)) {
    next.orderStatus = next.requestedStatus;
    if (!next.requestedStatus) delete next.orderStatus;
  }

  if (looksLikeClearExtraCosts(text)) {
    next.extraCosts = [];
    next.extraCostsAsked = true;
  }

  const saleTotal = moneyAmount(Number(next.amount) || 0);
  if (looksLikePayEverythingNow(text) && saleTotal > 0) {
    next.paid = true;
    next.payFullBalance = true;
    next.collectionAmount = undefined;
  } else if (looksLikeRelatedOrderPayment(text) || next.paid) {
    next.paid = true;
    if (!(Number(next.collectionAmount) > 0) && saleTotal > 0 && !next.payFullBalance) {
      next.collectionAmount = saleTotal;
    }
  }
}

/** «¿cómo quedó el pedido?» pregunta; «el pedido quedó listo» avisa. */
function looksLikeQuestion(text: string): boolean {
  if (/[¿?]/.test(text)) return true;
  const t = text.trim();
  if (/^(qu[eé]|c[oó]mo|cu[aá]l|cu[aá]les|d[oó]nde|cu[aá]nt[oa]s?|cu[aá]ndo)\b/i.test(t)) return true;
  return /\b(qu[eé]\s+(estado|saldo|pedido|pidi[oó]|compr[oó]|hay)|c[oó]mo\s+|cu[aá]l(?:es)?\s+|d[oó]nde\s+|cu[aá]nt[oa]s?\s+|cu[aá]ndo\s+)/i.test(
    t
  );
}

function orderStatusFromText(text: string): 'pendiente' | 'en_produccion' | 'listo' | 'entregado' {
  const named = text.match(
    /\b(?:move|mov[eé](?:lo|r)?|p[aá]s(?:[aá]|alo|amelo)|p[oó]n(?:[eé]lo|elo|[eé])|marc(?:[aá]|alo|amelo)|dej(?:[aá]|alo)|p[oó]nelo)\s+(?:el\s+|ese\s+|este\s+)?(?:pedido\s+)?(?:a|en|como)\s+(?:estado\s+)?(entregad[oa]|listo|pronto|terminad[oa]|pendiente|producci[oó]n)\b/i
  );
  const namedStatus = parseOrderStatus(named?.[1]);
  if (namedStatus) return namedStatus;
  const asEstado = text.match(
    /\ba\s+(?:estado\s+)?(entregad[oa]|listo|pronto|terminad[oa]|pendiente|producci[oó]n)\b/i
  );
  const asStatus = parseOrderStatus(asEstado?.[1]);
  if (asStatus) return asStatus;
  if (STATUS_DELIVERED_PATTERNS.test(text)) return 'entregado';
  if (STATUS_PRODUCTION_PATTERNS.test(text)) return 'en_produccion';
  if (/(?<![\p{L}])pendiente(?![\p{L}])/iu.test(text)) return 'pendiente';
  return 'listo';
}

export function looksLikeOrderStatusUpdate(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t || looksLikeQuestion(t) || looksLikeNewOrder(t)) return false;
  if (utteranceIsHowTo(t) || utteranceIsCapabilityQuestion(t)) return false;
  if (ORDER_STATUS_PATTERNS.test(t)) return true;
  const hasStatus =
    /(?<![\p{L}])(listo|pronto|terminad[oa]|entregad[oa]|pendiente|en\s+producci[oó]n|en\s+proceso)(?![\p{L}])/iu.test(
      t
    );
  if (!hasStatus) return false;
  const hasVerb =
    /(?<![\p{L}])(move|mov[eé](?:lo|r)?|p[aá]s[aá](?:lo|melo)?|p[oó]n(?:[eé]|elo|eme)?lo|p[oó]n[eé]|marc(?:[aá]|alo)|dej(?:[aá]|alo)|cambi(?:[aá]|alo|arle|arlo)|cambia(?:le)?)(?![\p{L}])/iu.test(
      t
    );
  const refersToOrder =
    /(?<![\p{L}])((?:el|ese|este)\s+pedido|a\s+estado|el\s+estado)(?![\p{L}])/iu.test(t);
  return hasVerb || refersToOrder;
}
/** «registrá un pedido», «nueva venta»: crear, no cobrar. */
const ORDER_CREATE_PATTERNS =
  /\b(ingres\w+|registr\w+|anot\w+|carg\w+|arm\w+|nuev[oa])\s+(un[ao]?\s+|el\s+|la\s+)?(pedido|orden)\b/i;
const COST_ITEM_PATTERNS =
  /\b((agreg[áa]|sum[áa]|anot[áa]|registr[áa]|cargar|poner|poneme|sumale|sumále|agregale|agregále|pon[eé]le)\s+(un\s+)?(?:(?:í|i)tem\s+de\s+)?(?:al\s+)?costos?|(agreg[áa]|sum[áa]|sumale|sumále|agregale|agregále)\s+\$?\s*[\d.]+\s+(?:al\s+)?costos?|al\s+costos?|costos?\s+extra|(?:í|i)tem\s+de\s+costo|costos?\s+(?:extra\s+)?(?:de\s+|del\s+|al\s+)?(?!pedido\b|orden\b|venta\b|de\b|del\b|al\b)[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}|[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{1,40}?\s+\$?\s*[\d.]+\s*(?:de\s+)?costos?|\bcostos?\s*\$?\s*\d)/i;
const CLIENT_REGISTER_PATTERNS =
  /\b((registr(?:ar|[áa])|nuevo|alta|cargar|anotar|agregar|crear)\s+(el\s+|un\s+|los\s+)?clientes?|clientes?\s+nuevos?)\b/i;
const BALANCE_PATTERNS =
  /\b((saldo|debe|cuenta)\s+(de|del)\s+(?!las\s+cajas?\b)(?!la\s+caja\b)(?!cajas?\b)|cu[aá]nto\s+debe)\b/i;
const CASH_QUERY_PATTERNS =
  /\b(caja\s+(de\s+)?hoy|cu[aá]nto\s+vend[ií]|resumen\s+(de\s+)?caja|movimientos?\s+(de\s+)?caja|cu[aá]nto\s+(hay\s+)?en\s+caja|saldo\s+neto|cu[aá]nto\s+saldo|saldo\s+(de\s+)?(la[s]?\s+)?cajas?|cu[aá]nto\s+tengo|cu[aá]nto\s+queda\s+en\s+(la\s+)?caja|qu[eé]\s+saldo\s+(tengo|hay))\b/i;
const CASH_OUT_PATTERNS =
  /(?<![\p{L}])(?:gasto|egreso|salida(?:\s+de\s+caja)?|(?:retir[eéoó]|sac[aáe](?:lo)?)\s+(?:plata\s+)?(?:de\s+)?(?:la\s+)?caja|(?:hace|hac[eé]|hacele|anot(?:ar|[aeáo])|registr(?:ar|[aeáo])|pon[eé]|cargar)\s+(?:un[ao]?\s+)?(?:egreso|gasto|salida))(?![\p{L}])/iu;
const CASH_IN_PATTERNS =
  /(?<![\p{L}])(?:ingreso\s+de\s+caja|entrada\s+de\s+caja|ingres[oaá]\s+(?:a|en)\s+(?:la\s+)?caja|entrada\s+(?:a|en)\s+(?:la\s+)?caja|(?:hace|hac[eé]|hacele|anot[aá]|registr[aá]|pon[eé]|cargar)\s+(?:un[ao]?\s+)?ingreso(?:\s+de\s+caja)?|(?:un\s+)?ingreso\s+(?:de\s+|por\s+)?\$?\s*[\d.]|(?:una\s+)?entrada\s+(?:de\s+|por\s+)?\$?\s*[\d.]|met[eé](?:r)?\s+plata(?:\s+en\s+(?:la\s+)?caja)?)(?![\p{L}])/iu;
const QUERY_STATUS_PATTERNS =
  /\b(en\s+qu[eé]\s+estado|qu[eé]\s+estado|c[oó]mo\s+qued[oó]|c[oó]mo\s+lo\s+(registraste|anotaste|dejaste|pusiste|cargaste)|c[oó]mo\s+est[aá]\s+(el|la|ese|esa|esto|eso)|busc(?:[aá]|ar)\s+(el\s+|un\s+)?(pedido|venta|compra)|resumen\s+(del|de\s+(el|la|ese|esa|esto|eso)|pedido)|el\s+[uú]ltimo\s+(pedido|venta)|pedido\s*#\s*\d+|qu[eé]\s+(le\s+)?(pusiste|anotaste|registraste|pidi[oó]|compr[oó])|d[oó]nde\s+lo\s+(dejaste|pusiste|anotaste)|n(?:ro\.?|[uú]m(?:ero)?)(?:\s+de)?\s+pedido|qu[eé]\s+n(?:ro\.?|[uú]mero)|tiene\s+(el\s+)?pedido|cu[aá]l\s+es\s+el\s+pedido|el\s+pedido\s+de|qu[eé]\s+pidi[oó]|qu[eé]\s+compr[oó]|qu[eé]\s+le\s+(anotamos|cargamos|pusimos))/i;
const LIST_ORDERS_PATTERNS =
  /\b((list(?:ame|[áa])?|mostr(?:ame|[áa])|busc(?:ame|[áa]))\s+(los\s+|el\s+|la\s+|un\s+|de\s+)?(pedidos?)?|qu[eé]\s+pedidos?(?:\s+hay)?|pedidos?\s+(con\s+saldo|abiertos?|pendientes?|sin\s+pagar)|no\s+s[eé]\s+(de\s+)?qu[eé]\s+pedido)\b/i;
const ORPHAN_PAYMENT_PATTERNS =
  /\b(me\s+lleg[oó]\s+(un\s+)?pago|me\s+pagaron|lleg[oó]\s+(una\s+)?transferencia|un\s+pago\s+de)\b/i;
const STOCK_QUERY_PATTERNS =
  /\b(cu[aá]nt[oa]s?\s+(?:tengo|hay|quedan?|me\s+quedan)|qu[eé]\s+stock|stock\s+(?:de|tengo)|cu[aá]ntas?\s+\w+|tengo\s+de\s+)/i;

const ALLOWED_INTENTS: WhatsappIntent[] = [
  'help',
  'how_to',
  'capability_question',
  'greeting',
  'create_order',
  'create_sale',
  'create_purchase',
  'register_payment',
  'query_balance',
  'query_cash',
  'query_status',
  'query_stock',
  'register_cash',
  'create_client',
  'register_cost',
  'update_product_cost',
  'update_order_status',
  'unknown',
];

function compactKnownEntities(entities?: WhatsappCommandEntities): Record<string, unknown> {
  if (!entities) return {};
  const keys: Array<keyof WhatsappCommandEntities> = [
    'clientName',
    'spokenClientName',
    'productName',
    'spokenProductName',
    'quantity',
    'amount',
    'notes',
    'deliveryDate',
    'orderDate',
    'supplierName',
    'paid',
    'extraCosts',
    'collectionAmount',
    'requestedStatus',
    'extraCostsEnabled',
    'extraCostsAsked',
    'extraCostsProductHint',
    'extraCostsTargetItemIndex',
    'orderNumber',
    'targetOrderId',
    'targetOrderLabel',
    'orderStatus',
    'payFullBalance',
    'listOrders',
    'cashType',
    'cashConcept',
    'cashAmbitoHint',
    'cashAmbitoId',
    'cashAmbitoLabel',
    'items',
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = entities[key];
    if (value == null || value === '') continue;
    out[key] = value;
  }
  return out;
}

export function looksLikeListOrders(text: string): boolean {
  return LIST_ORDERS_PATTERNS.test(String(text ?? ''));
}

export function looksLikeOrphanPayment(text: string): boolean {
  return ORPHAN_PAYMENT_PATTERNS.test(String(text ?? ''));
}

export function looksLikeCashMovement(text: string): boolean {
  const t = String(text ?? '');
  if (!t.trim()) return false;
  if (ORDER_CREATE_PATTERNS.test(t)) return false;
  return CASH_OUT_PATTERNS.test(t) || CASH_IN_PATTERNS.test(t);
}

function looksLikeHowToQuestion(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return (
    /\bc[oó]mo\s+(funciona|uso|registro|anoto|hablo|te uso|hago)\b/i.test(lower) ||
    /^(consultame|consultáme|ayuda|help|comandos)[\s?¿!.]*$/i.test(lower)
  );
}

function looksLikeHelpRequest(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return false;
  if (utteranceIsHowTo(text) || utteranceIsCapabilityQuestion(text)) return false;
  if (looksLikeHowToQuestion(lower)) return true;
  if (
    ORDER_PATTERNS.test(lower) ||
    SALE_PATTERNS.test(lower) ||
    PURCHASE_PATTERNS.test(lower) ||
    PAYMENT_PATTERNS.test(lower) ||
    CLIENT_REGISTER_PATTERNS.test(lower)
  ) {
    return false;
  }
  return (
    /\b(consultame|consultáme|ayuda|help|comandos)\b/i.test(lower) ||
    /\bqu[eé]\s+(pod[eé]s|podes|puedes)\s+hacer\b/i.test(lower) ||
    /\bqu[eé]\s+hac[eé]s\b/i.test(lower) ||
    /\bejemplos?\b/i.test(lower) ||
    /\bcat[aá]logo\b/i.test(lower) ||
    /\b(qu[eé]\s+productos?|lista de productos?|mis productos?|los productos)\b/i.test(lower) ||
    /^(productos?|cat[aá]logo)[\s?¿!.]*$/i.test(lower)
  );
}

function parseFollowUpAction(raw: unknown): WhatsappFollowUpAction | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  return FOLLOW_UP_ACTIONS.includes(value as WhatsappFollowUpAction)
    ? (value as WhatsappFollowUpAction)
    : undefined;
}

function recoverDateMistakenAsClient(entities: WhatsappCommandEntities): void {
  const client = String(entities.clientName ?? '').trim();
  if (!client || !isUnlikelyPersonName(client)) return;
  const fromClient = extractDeliveryDateFromText(client);
  if (fromClient && !entities.deliveryDate) entities.deliveryDate = fromClient;
  const spoken = String(entities.spokenClientName ?? '').trim();
  if (spoken && !isUnlikelyPersonName(spoken) && spoken.toLowerCase() !== client.toLowerCase()) {
    entities.clientName = spoken;
    entities.clientId = undefined;
    return;
  }
  entities.clientName = undefined;
  entities.clientId = undefined;
  if (spoken && isUnlikelyPersonName(spoken)) entities.spokenClientName = undefined;
}

function cleanedProductName(value: string): string {
  const raw = value.trim();
  if (!raw) return raw;
  return extractProductHintFromText(raw) || raw;
}

function isEmptyEntityValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return !value.trim();
  if (typeof value === 'number') return !Number.isFinite(value) || value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Gemini a menudo manda null/"" y no debe borrar lo que las reglas ya sacaron. */
function coalesceEntities(
  rules: WhatsappCommandEntities,
  gemini: WhatsappCommandEntities
): WhatsappCommandEntities {
  const next: WhatsappCommandEntities = { ...rules, ...gemini };
  const keys: Array<keyof WhatsappCommandEntities> = [
    'clientName',
    'spokenClientName',
    'clientPhone',
    'productName',
    'spokenProductName',
    'quantity',
    'amount',
    'seniaAmount',
    'notes',
    'deliveryDate',
    'orderDate',
    'supplierName',
    'invoiceNumber',
    'paymentHint',
    'purchaseLines',
    'items',
    'sourceText',
    'rawUserMessage',
    'extraCosts',
    'collectionAmount',
    'requestedStatus',
    'extraCostsEnabled',
    'extraCostsAsked',
    'extraCostsProductHint',
    'extraCostsTargetItemIndex',
    'orderNumber',
    'targetOrderId',
    'targetOrderLabel',
    'orderStatus',
    'payFullBalance',
    'listOrders',
    'cashType',
    'cashConcept',
    'cashAmbitoHint',
    'cashAmbitoId',
    'cashAmbitoLabel',
  ];
  for (const key of keys) {
    if (isEmptyEntityValue(gemini[key]) && !isEmptyEntityValue(rules[key])) {
      (next as Record<string, unknown>)[key] = rules[key];
    }
  }
  if (typeof gemini.productName === 'string' && gemini.productName.trim()) {
    next.productName = cleanedProductName(gemini.productName);
  } else if (typeof rules.productName === 'string' && rules.productName.trim()) {
    next.productName = cleanedProductName(rules.productName);
  }
  if (rules.listOrders || gemini.listOrders) next.listOrders = true;
  next.items = coalesceOrderItems(
    rules.items,
    gemini.items,
    String(gemini.sourceText || rules.sourceText || '')
  );
  if (!next.items.length) delete next.items;
  return next;
}

/** Gemini ya interpretó. Solo rellenar huecos de reglas; no re-extraer semántica del raw. */
function adoptGeminiEntities(
  geminiEntities: WhatsappCommandEntities,
  ruleEntities: WhatsappCommandEntities,
  raw: string
): WhatsappCommandEntities {
  const next = coalesceEntities(ruleEntities, geminiEntities);
  if (!next.rawUserMessage) next.rawUserMessage = raw;
  if (!next.sourceText) next.sourceText = raw;
  if (next.notes) {
    const sanitized = sanitizeOrderNotes(next.notes);
    if (sanitized) next.notes = sanitized;
    else delete next.notes;
  }
  if (next.items?.length || next.productName) {
    ensureOrderItems(next);
    syncLegacyProductFields(next);
  }
  recoverDateMistakenAsClient(next);
  return next;
}

/** Junta lo ya cargado con lo nuevo. No pisa un cliente real con un día de la semana. */
export function applyEntityUpdates(
  known: WhatsappCommandEntities,
  incoming: WhatsappCommandEntities,
  rawText = ''
): WhatsappCommandEntities {
  const next: WhatsappCommandEntities = { ...known };
  const text = rawText.trim();
  const combined = [known.sourceText, text].filter(Boolean).join('\n').slice(0, 2000);
  if (combined) next.sourceText = combined;
  const incomingClient = String(incoming.clientName ?? '').trim();

  if (incomingClient && !isUnlikelyPersonName(incomingClient)) {
    const current = String(next.clientName ?? '').trim();
    const incomingSpoken = String(incoming.spokenClientName ?? incomingClient).trim();
    const complete = preferCompleteEntityName(incomingSpoken, incomingClient);
    const correcting = looksLikeClientCorrection(text);
    if (next.clientLocked && complete.toLowerCase() !== current.toLowerCase() && !correcting) {
      // keep locked client
    } else if (complete.toLowerCase() !== current.toLowerCase()) {
      next.spokenClientName = preferCompleteEntityName(incomingSpoken, next.spokenClientName) || complete;
      next.clientName = preferCompleteEntityName(complete, current) || complete;
      next.clientId = undefined;
      next.clientLocked = undefined;
    } else {
      next.spokenClientName =
        preferCompleteEntityName(next.spokenClientName, incomingSpoken) || next.spokenClientName;
    }
  }

  if (incoming.clientPhone) next.clientPhone = incoming.clientPhone;
  if (incoming.productName) {
    const productName = cleanedProductName(incoming.productName);
    const knownProduct = String(known.productName ?? '').trim();
    const incomingIsWholeBlurb =
      Boolean(knownProduct) &&
      productName.length > 40 &&
      text.length > 40 &&
      productName.toLowerCase().slice(0, 32) === text.toLowerCase().slice(0, 32);
    if (!incomingIsWholeBlurb) {
      const productLocked = (known.items ?? []).some((item) => item.productLocked && item.productId);
      if (productLocked && !looksLikeProductCorrection(text) && productName.toLowerCase() !== knownProduct.toLowerCase()) {
        // keep locked product
      } else {
        next.spokenProductName = next.spokenProductName || incoming.spokenProductName || productName;
        if (productName.toLowerCase() !== knownProduct.toLowerCase()) {
          next.productId = incoming.productId || undefined;
        }
        next.productName = productName;
      }
    }
  }
  if (incoming.quantity) next.quantity = incoming.quantity;
  if (incoming.amount) next.amount = incoming.amount;
  if (incoming.deliveryDate) next.deliveryDate = incoming.deliveryDate;
  if (incoming.orderDate) next.orderDate = incoming.orderDate;
  if (incoming.paid != null) next.paid = incoming.paid;
  if (incoming.cashType) next.cashType = incoming.cashType;
  if (incoming.cashConcept) next.cashConcept = incoming.cashConcept;
  if (incoming.cashAmbitoHint) next.cashAmbitoHint = incoming.cashAmbitoHint;
  if (incoming.cashAmbitoId) next.cashAmbitoId = incoming.cashAmbitoId;
  if (incoming.cashAmbitoLabel) next.cashAmbitoLabel = incoming.cashAmbitoLabel;
  if (incoming.supplierName) {
    next.supplierName = incoming.supplierName;
    next.supplierId = undefined;
  }
  if (incoming.invoiceNumber) next.invoiceNumber = incoming.invoiceNumber;
  if (incoming.purchaseLines?.length) next.purchaseLines = incoming.purchaseLines;
  if (incoming.items?.length || (next.items?.length && text)) {
    const follow = applyFollowUpToEntities(next, text, undefined, {
      conversationAction: incoming.conversationAction || 'continue_current',
      items: incoming.items ?? [],
      deliveryDate: incoming.deliveryDate,
    });
    next.items = follow.items;
    syncLegacyProductFields(next);
  }
  if (incoming.paymentHint) next.paymentHint = incoming.paymentHint;
  if (incoming.paymentKind) next.paymentKind = incoming.paymentKind;
  if (incoming.seniaAmount) next.seniaAmount = incoming.seniaAmount;
  if (incoming.collectionAmount) next.collectionAmount = incoming.collectionAmount;
  if (incoming.requestedStatus) {
    next.requestedStatus = incoming.requestedStatus;
    next.orderStatus = incoming.requestedStatus;
  } else {
    const explicit = extractExplicitRequestedStatus(text);
    if (explicit) {
      next.requestedStatus = explicit;
      next.orderStatus = explicit;
    }
  }
  if (incoming.extraCostsEnabled != null) next.extraCostsEnabled = incoming.extraCostsEnabled;
  if (incoming.extraCostsAsked) next.extraCostsAsked = true;
  if (incoming.extraCostsProductHint) next.extraCostsProductHint = incoming.extraCostsProductHint;
  if (Number.isInteger(incoming.extraCostsTargetItemIndex)) {
    next.extraCostsTargetItemIndex = incoming.extraCostsTargetItemIndex;
  }
  if (incoming.payFullBalance) next.payFullBalance = true;
  if (incoming.paymentCuotas) next.paymentCuotas = incoming.paymentCuotas;
  if (incoming.saveAsDraft) next.saveAsDraft = true;
  if (incoming.extraCosts?.length || next.extraCosts?.length) {
    const mergedCosts = mergeExtraCostItems(next.extraCosts, incoming.extraCosts);
    if (mergedCosts.length) next.extraCosts = mergedCosts;
  }
  if (incoming.orderNumber) next.orderNumber = incoming.orderNumber;
  if (incoming.referToLast) next.referToLast = true;
  if (incoming.targetOrderId) next.targetOrderId = incoming.targetOrderId;
  if (incoming.targetOrderLabel) next.targetOrderLabel = incoming.targetOrderLabel;
  if (incoming.notes) {
    const notes = sanitizeOrderNotes(incoming.notes);
    if (notes) {
      next.notes = notes;
      next.notesAsked = true;
    }
  }
  if (incoming.notesAsked) next.notesAsked = true;
  if (incoming.deliveryDate) {
    next.deliveryAsked = true;
    if (!incoming.deliveryDefaulted) next.deliveryDefaulted = undefined;
  }
  if (incoming.deliveryAsked) next.deliveryAsked = true;
  if (incoming.deliveryDefaulted) next.deliveryDefaulted = true;

  const spoken = extractSpokenCorrections(text, next);
  if (spoken.clientName && !isUnlikelyPersonName(spoken.clientName)) {
    if (spoken.clientName.toLowerCase() !== String(next.clientName ?? '').trim().toLowerCase()) {
      next.clientName = spoken.clientName;
      next.spokenClientName = spoken.clientName;
      next.clientId = undefined;
    }
  }
  if (spoken.productName) {
    const productName = cleanedProductName(spoken.productName);
    if (productName && productName.toLowerCase() !== String(next.productName ?? '').trim().toLowerCase()) {
      next.productId = undefined;
      next.productAsConcept = undefined;
    }
    if (productName) {
      next.productName = productName;
      next.spokenProductName = productName;
    }
  }
  if (spoken.amount) next.amount = spoken.amount;
  if (spoken.deliveryDate) {
    next.deliveryDate = spoken.deliveryDate;
    next.deliveryAsked = true;
    next.deliveryDefaulted = undefined;
  }
  if (spoken.notes) {
    const notes = sanitizeOrderNotes(spoken.notes);
    if (notes) {
      next.notes = notes;
      next.notesAsked = true;
    }
  }
  if (spoken.clearNotes) {
    next.notes = undefined;
    next.notesAsked = true;
  }
  next.extraCosts = mergeExtraCostItems(next.extraCosts, extractExtraCostsFromText(combined || text));
  if (!next.extraCosts.length) delete next.extraCosts;
  const extraHint = extractExtraCostProductHint(combined || text);
  if (extraHint && !next.extraCostsProductHint) next.extraCostsProductHint = extraHint;

  if (!next.deliveryDate && !next.deliveryAsked) {
    const delivery = extractDeliveryDateFromText(text);
    if (delivery) {
      next.deliveryDate = delivery;
      next.deliveryAsked = true;
      next.deliveryDefaulted = undefined;
    }
  }
  if (!(Number(next.amount) > 0)) {
    const amount = extractAmountFromText(text);
    if (amount) next.amount = amount;
  }
  const productFromText = extractProductHintFromText(text);
  if (productFromText) {
    const current = String(next.productName ?? '').trim();
    const clientOnly = /\bcliente\b/i.test(text) && !/\b(producto|talle)\b/i.test(text);
    const looksLikeStampCopy =
      text.length > 40 &&
      /\b(soy el|principe|príncipe|nombre del beb[eé]|estampad|frase|adelante|atr[aá]s|pecho|espalda)\b/i.test(
        text
      );
    const allowReplace =
      !clientOnly &&
      !looksLikeStampCopy &&
      (Boolean(spoken.productName) ||
        /\b(producto|camiseta|remera|buzo|jean|pantal|taza|campera)\b/i.test(text));
    if (!current) {
      next.productName = productFromText;
      next.spokenProductName = next.spokenProductName || productFromText;
    } else if (allowReplace && productFromText.toLowerCase() !== current.toLowerCase()) {
      next.productName = productFromText;
      next.spokenProductName = productFromText;
      next.productId = undefined;
    }
  }
  if (!next.notes) {
    const notes = extractNotesHintFromText(combined || text);
    if (notes) {
      next.notes = notes;
      next.notesAsked = true;
    }
  }
  if (!next.clientName) {
    const hint = looksLikeStatusQuery(text)
      ? extractQueryClientFromText(text) || extractClientHintFromText(text)
      : extractClientHintFromText(text) || extractQueryClientFromText(text);
    if (hint) {
      next.clientName = hint;
      next.spokenClientName = next.spokenClientName || hint;
    }
  }
  applyCompletePartyFromUtterance(combined || text, next);

  applyCreateOrderPaymentAndStatus(next, text);
  recoverDateMistakenAsClient(next);
  return next;
}

export function sanitizeWhatsappEntities(entities: WhatsappCommandEntities): void {
  recoverDateMistakenAsClient(entities);
  if (entities.deliveryDate) entities.deliveryAsked = true;
}

/** @deprecated llm_first: no enriquecer entidades desde el utterance. Solo parseWithRules/legacy. */
function enrichEntitiesFromText(
  text: string,
  entities: WhatsappCommandEntities = {}
): WhatsappCommandEntities {
  const next = { ...entities };
  if (text && !next.sourceText) next.sourceText = text.slice(0, 2000);
  if (next.clientName && isUnlikelyPersonName(next.clientName)) {
    if (!next.deliveryDate && !next.deliveryAsked) {
      const delivery = extractDeliveryDateFromText(next.clientName);
      if (delivery) {
        next.deliveryDate = delivery;
        next.deliveryAsked = true;
        next.deliveryDefaulted = undefined;
      }
    }
    next.clientName = undefined;
  }
  if (next.amount == null) {
    const amount = extractAmountFromText(text);
    if (amount != null) next.amount = amount;
  }
  if (next.seniaAmount == null) {
    const senia = extractSeniaFromText(text);
    if (senia != null) next.seniaAmount = senia;
  }
  if (!next.clientName || !next.clientPhone) {
    const registered = extractRegisterClientFromText(text);
    if (registered?.name && !next.clientName && !isUnlikelyPersonName(registered.name)) {
      next.clientName = registered.name;
    }
    if (registered?.phone && !next.clientPhone) next.clientPhone = registered.phone;
  }
  if (!next.clientName) {
    const hint = looksLikeStatusQuery(text)
      ? extractQueryClientFromText(text) || extractClientHintFromText(text)
      : extractClientHintFromText(text) || extractQueryClientFromText(text);
    if (hint) {
      next.clientName = hint;
      if (!next.spokenClientName) next.spokenClientName = hint;
    }
  }
  if (!next.clientPhone) {
    const parsedPhone = parsePersonNameAndPhone(text);
    if (parsedPhone.telefono) next.clientPhone = parsedPhone.telefono;
  }
  if (!next.deliveryDate && !next.deliveryAsked) {
    const delivery = extractDeliveryDateFromText(text);
    if (delivery) {
      next.deliveryDate = delivery;
      next.deliveryAsked = true;
      next.deliveryDefaulted = undefined;
    }
  }
  if (next.productName) {
    const cleaned = cleanedProductName(next.productName);
    if (cleaned) next.productName = cleaned;
  }
  if (!next.items?.length && !next.productName && !isNonProductUtterance(text)) {
    const product = extractProductHintFromText(text);
    if (product) {
      const split = splitConcatenatedProductText(product);
      if (split.length) {
        next.items = split;
        syncLegacyProductFields(next);
      } else {
        next.productName = product;
        if (!next.spokenProductName) next.spokenProductName = product;
      }
    }
  }
  if (next.items?.length) {
    ensureOrderItems(next);
    syncLegacyProductFields(next);
  } else if (next.productName) {
    ensureOrderItems(next);
    syncLegacyProductFields(next);
  }
  traceOrderItems('after-normalization', next.items);
  next.extraCosts = next.extraCosts?.length
    ? next.extraCosts
    : mergeExtraCostItems(undefined, extractExtraCostsFromText(text));
  if (!next.extraCosts.length) delete next.extraCosts;
  if (!next.extraCostsProductHint) {
    const extraHint = extractExtraCostProductHint(text);
    if (extraHint) next.extraCostsProductHint = extraHint;
  }
  if (/\bsin\s+(descripci[oó]n|detalle|notas?|observaciones)\b/i.test(text)) {
    next.notesAsked = true;
    next.notes = undefined;
  }
  if (!next.notes) {
    const notes = sanitizeOrderNotes(extractNotesHintFromText(text) ?? undefined);
    if (notes) {
      next.notes = notes;
      next.notesAsked = true;
    }
  } else {
    next.notes = sanitizeOrderNotes(next.notes);
    if (!next.notes) next.notesAsked = next.notesAsked || undefined;
  }
  if (!next.orderDate) {
    const orderDate = extractOrderDateFromText(text);
    if (orderDate) next.orderDate = orderDate;
  }
  if (!next.orderNumber) {
    const orderNumber = extractOrderNumberFromText(text);
    if (orderNumber) next.orderNumber = orderNumber;
  }
  if (!next.supplierName) {
    const supplierHint = text.match(
      /\b(?:compra(?:\s+a)?|proveedor)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .&'-]{1,50})/i
    );
    if (supplierHint?.[1]) {
      next.supplierName = supplierHint[1].trim().replace(/[.,;:!?]+$/, '');
    }
  }
  if (!next.purchaseLines?.length && !looksLikeNewOrder(text)) {
    const lines = parsePurchaseLinesFromText(text);
    if (lines?.length) next.purchaseLines = lines;
  }
  if (next.purchaseLines?.length) {
    next.purchaseLines = grossUpPurchaseLinesIfVatSeparated(next.purchaseLines, next.amount);
  }
  if (/\b(borrador|completar (en )?el panel|lo completo yo)\b/i.test(text)) {
    next.saveAsDraft = true;
  }
  if (!next.paymentHint) {
    const hint = text.match(
      /\b(efectivo|contado|transferencia|transf\.?|d[eé]bito|mercado\s*pago|\bmp\b|tarjeta|cr[eé]dito|visa|proveedor|fiado|cuenta\s+corriente|pendiente)\b/i
    );
    if (hint?.[1]) next.paymentHint = hint[1].trim();
  }
  if (!next.paymentCuotas) {
    const cuotas = text.match(/(\d{1,2})\s*cuotas?/i);
    if (cuotas) next.paymentCuotas = Math.min(120, Math.max(1, Number(cuotas[1]) || 1));
  }
  applyCompletePartyFromUtterance(text, next);
  if (looksLikeNewOrder(text) && looksLikeRelatedOrderPayment(text)) {
    next.paid = true;
  }
  applyCreateOrderPaymentAndStatus(next, text);
  recoverDateMistakenAsClient(next);
  return next;
}

function parsePurchaseLinesFromText(text: string): WhatsappPurchaseLine[] | undefined {
  const matches = [
    ...text.matchAll(
      /(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{1,60}?)\s+(?:a|@|x|por)\s*\$?\s*([\d.]+(?:,\d+)?)/gi
    ),
  ];
  if (!matches.length) return undefined;
  const lines: WhatsappPurchaseLine[] = [];
  for (const match of matches) {
    const quantity = Math.max(1, Number(String(match[1]).replace(',', '.')) || 1);
    const productName = String(match[2] ?? '').trim().replace(/[.,;:]+$/, '');
    const unitCost = Math.max(0, Number(String(match[3]).replace(/\./g, '').replace(',', '.')) || 0);
    if (!productName) continue;
    lines.push({ productName, invoiceName: productName, quantity, unitCost });
  }
  return lines.length ? lines : undefined;
}

/**
 * @deprecated llm_first no usa este parser para texto libre.
 * Solo engine legacy, gates de pending y tests de cobertura.
 */
export function parseWithRules(
  message: string,
  conversation?: WhatsappParseConversation
): ParsedWhatsappCommand {
  const text = message.trim();
  if (!text) {
    return { intent: 'unknown', confidence: 0, raw: text };
  }

  const lower = text.toLowerCase();
  if (/^(hola|holaa+|buenas|buen[oa]s?\s+d[ií]as?|buen[oa]s?\s+tardes?|hey|hello)[\s!¡?.]*$/i.test(lower)) {
    return { intent: 'greeting', confidence: 0.9 };
  }
  if (utteranceIsHowTo(text)) {
    const count = expectedItemCountFromText(text);
    return {
      intent: 'how_to',
      confidence: 0.94,
      conversationAction: 'answer_current',
      entities: {
        helpTopic: howToTopicFromText(text),
        expectedItemCount: count,
        productName: undefined,
        items: undefined,
      },
      raw: text,
    };
  }
  if (utteranceIsCapabilityQuestion(text)) {
    return {
      intent: 'capability_question',
      confidence: 0.93,
      conversationAction: 'answer_current',
      entities: {
        helpTopic: howToTopicFromText(text),
        expectedItemCount: expectedItemCountFromText(text),
        productName: undefined,
        items: undefined,
      },
      raw: text,
    };
  }
  if (looksLikeHelpRequest(text)) {
    return { intent: 'help', confidence: 0.92, raw: text };
  }

  const entities = enrichEntitiesFromText(text);
  if (
    (conversation?.awaiting === STOCK_RESOLUTION_INTENT ||
      isStockResolutionPending(conversation?.pendingIntent)) &&
    !looksLikeNewOrder(text) &&
    !looksLikeCashMovement(text)
  ) {
    const choice = interpretStockResolutionFromText(text);
    const wholeIsQuery =
      !choice.action &&
      !choice.leftover &&
      (looksLikeExistingOrderQuery(text) || looksLikeStatusQuery(text));
    if (!wholeIsQuery) {
      return pinFocusOrderToParsed(
        {
          intent: 'update_order_status',
          confidence: 0.95,
          conversationAction: choice.action === 'cancel' ? 'cancel_current' : 'answer_current',
          entities: {
            ...entities,
            productName: undefined,
            spokenProductName: undefined,
            items: undefined,
            stockResolution: choice.action ?? undefined,
            descuentoFisicoAlcance: scopeFromStockResolution(choice.action),
            referToLast: true,
          },
          raw: text,
        },
        conversation
      );
    }
  }

  if (/^(el\s+)?saldos?[\s?¿!.]*$/i.test(text)) {
    return { intent: 'query_cash', confidence: 0.92, entities, raw: text };
  }
  const inProgressOrder =
    conversation?.originalIntent === 'create_order' ||
    conversation?.originalIntent === 'create_sale' ||
    conversation?.awaiting === 'deliveryDate' ||
    conversation?.awaiting === 'notes' ||
    conversation?.awaiting === 'fields';
  const isNewOrder =
    looksLikeNewOrder(text) ||
    /\b(pedido|orden)\s+(para|nuevo|nueva)\b/i.test(text) ||
    /\b(pedido|orden)\s+a(?!\s+estado)\b/i.test(text);
  const catalogCost = extractCatalogCostUpdate(text);
  if (catalogCost && !isNewOrder && !PURCHASE_PATTERNS.test(text) && !SALE_PATTERNS.test(text)) {
    return {
      intent: 'update_product_cost',
      confidence: 0.9,
      entities: {
        ...entities,
        productName: catalogCost.productName,
        spokenProductName: catalogCost.productName,
        amount: catalogCost.amount,
      },
      raw: text,
    };
  }
  if (
    COST_ITEM_PATTERNS.test(text) &&
    !isNewOrder &&
    !inProgressOrder &&
    !PURCHASE_PATTERNS.test(text) &&
    !SALE_PATTERNS.test(text)
  ) {
    const extraCosts = entities.extraCosts?.length ? entities.extraCosts : extractExtraCostsFromText(text);
    const orderNumber = extractOrderNumberFromText(text) || entities.orderNumber;
    const clientName = extractQueryClientFromText(text) || undefined;
    return {
      intent: 'register_cost',
      confidence: 0.88,
      entities: {
        ...entities,
        ...(extraCosts.length ? { extraCosts } : {}),
        ...(orderNumber ? { orderNumber } : {}),
        ...(clientName ? { clientName, spokenClientName: entities.spokenClientName || clientName } : {}),
        referToLast: !orderNumber && !clientName,
      },
      raw: text,
    };
  }
  // «el pedido quedó listo», «se lo entregué y me pagó»: avanza un pedido que ya existe.
  const settleLike = looksLikeCollectFullBalance(text) || SETTLE_BALANCE_PATTERNS.test(text);
  const paidMentioned = PAY_FULL_PATTERNS.test(text) && !settleLike;
  if (
    looksLikeOrderStatusUpdate(text) &&
    !isNewOrder &&
    !ORDER_CREATE_PATTERNS.test(text) &&
    !PURCHASE_PATTERNS.test(text) &&
    !looksLikeQuestion(text)
  ) {
    const orderNumber = extractOrderNumberFromText(text) || entities.orderNumber;
    const clientName = entities.clientName || extractQueryClientFromText(text) || undefined;
    const fromText = orderStatusFromText(text);
    const clientLooksReal =
      Boolean(clientName) &&
      !/^(estado|entregad[oa]|listo|pendiente|producci[oó]n|proceso|pedido|pone|pon[eé]|ponelo|move|movelo|pasalo|marcalo|dejalo|cambialo|ahora)$/i.test(
        clientName
      );
    return pinFocusOrderToParsed(
      {
        intent: 'update_order_status',
        confidence: 0.9,
        entities: {
          ...entities,
          productName: undefined,
          spokenProductName: undefined,
          items: undefined,
          orderStatus: fromText,
          ...(paidMentioned || settleLike ? { paid: true, payFullBalance: true } : {}),
          ...(orderNumber ? { orderNumber } : {}),
          ...(clientLooksReal
            ? { clientName, spokenClientName: entities.spokenClientName || clientName }
            : { clientName: undefined, spokenClientName: undefined }),
          referToLast: !orderNumber && !clientLooksReal,
        },
        raw: text,
      },
      conversation
    );
  }

  // «seña de Ana 200», «cobré 500 del pedido 223», «me llegó un pago»: cobro sobre algo ya guardado.
  const seniaLike = SENIA_PATTERNS.test(text);
  if (
    (seniaLike || PAYMENT_LEAD_PATTERNS.test(text) || ORPHAN_PAYMENT_PATTERNS.test(text) || settleLike) &&
    !isNewOrder &&
    !ORDER_CREATE_PATTERNS.test(text) &&
    !SALE_PATTERNS.test(text) &&
    !PURCHASE_PATTERNS.test(text) &&
    !looksLikeCashMovement(text)
  ) {
    const orderNumber = extractOrderNumberFromText(text) || entities.orderNumber;
    const clientName = entities.clientName || extractQueryClientFromText(text) || undefined;
    const payAll = settleLike || PAY_FULL_PATTERNS.test(text);
    return {
      intent: 'register_payment',
      confidence: 0.88,
      entities: {
        ...entities,
        paymentKind: seniaLike ? 'senia' : 'pago',
        // En un cobro la plata es la seña, no el precio de nada.
        ...(entities.seniaAmount ? { amount: entities.seniaAmount } : {}),
        ...(payAll ? { payFullBalance: true, paid: true } : {}),
        ...(orderNumber ? { orderNumber } : {}),
        ...(clientName ? { clientName, spokenClientName: entities.spokenClientName || clientName } : {}),
        referToLast: !orderNumber && /\b(ese|esa|este|esta|el [uú]ltimo|lo)\b/i.test(text),
      },
      raw: text,
    };
  }
  if (LIST_ORDERS_PATTERNS.test(text) && !isNewOrder && !ORDER_CREATE_PATTERNS.test(text)) {
    const orderNumber = extractOrderNumberFromText(text) || entities.orderNumber;
    const clientName = extractQueryClientFromText(text) || entities.clientName || undefined;
    return {
      intent: 'query_status',
      confidence: 0.94,
      entities: {
        ...entities,
        listOrders: true,
        ...(orderNumber ? { orderNumber } : {}),
        ...(clientName ? { clientName, spokenClientName: entities.spokenClientName || clientName } : {}),
        referToLast: false,
      },
      raw: text,
    };
  }
  const statusQuery =
    !isNewOrder &&
    (QUERY_STATUS_PATTERNS.test(text) ||
      looksLikeStatusQuery(text) ||
      looksLikeExistingOrderQuery(text) ||
      (Boolean(conversation?.lastOperation?.id || conversation?.focusOrder?.id) &&
        /\b(estado|resumen|saldo|lo|eso|ese|esta|este|el [uú]ltimo|pidi[oó]|compr[oó]|n[uú]mero)/i.test(text) &&
        !/\b(pedido|orden)\s+(para|a|de)\b/i.test(text) &&
        !PAYMENT_PATTERNS.test(text) &&
        !SALE_PATTERNS.test(text) &&
        !PURCHASE_PATTERNS.test(text)));
  if (statusQuery) {
    const orderNumber = extractOrderNumberFromText(text) || entities.orderNumber;
    const clientName = extractQueryClientFromText(text) || entities.clientName || undefined;
    return pinFocusOrderToParsed(
      {
        intent: 'query_status',
        confidence: 0.93,
        conversationAction: 'new_task',
        entities: {
          ...entities,
          productName: undefined,
          spokenProductName: undefined,
          items: undefined,
          ...(orderNumber ? { orderNumber } : {}),
          ...(clientName ? { clientName, spokenClientName: entities.spokenClientName || clientName } : {}),
          referToLast: !orderNumber && !clientName,
        },
        raw: text,
      },
      conversation
    );
  }
  if (CLIENT_REGISTER_PATTERNS.test(text)) {
    return { intent: 'create_client', confidence: 0.9, entities, raw: text };
  }
  if (
    (CASH_OUT_PATTERNS.test(text) || CASH_IN_PATTERNS.test(text)) &&
    !ORDER_CREATE_PATTERNS.test(text) &&
    !ORDER_PATTERNS.test(text) &&
    !SALE_PATTERNS.test(text)
  ) {
    const cashType: 'ingreso' | 'egreso' = CASH_OUT_PATTERNS.test(text) ? 'egreso' : 'ingreso';
    const motivo = text.match(/\b(?:por\s+)?(?:motivo|concepto|descripci[oó]n)\s+(.+)$/i);
    const concept =
      String(motivo?.[1] ?? '')
        .replace(/\$?\s*[\d.,]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() ||
      text
        .replace(CASH_OUT_PATTERNS, ' ')
        .replace(CASH_IN_PATTERNS, ' ')
        .replace(/\$?\s*[\d.,]+/g, ' ')
        .replace(/\bdescripci[oó]n\b[:\s]*/gi, ' ')
        .replace(/\b(registr(?:ar|[aeáo])|anot(?:ar|[aeáo])|hac[eé]|cargar|una?|de|la|el|caja|por|motivo|concepto)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim() ||
      (cashType === 'egreso' ? 'Egreso' : 'Ingreso');
    return {
      intent: 'register_cash',
      confidence: 0.92,
      entities: { ...entities, cashType, cashConcept: concept, cashAmbitoHint: text },
      raw: text,
    };
  }
  if (CASH_QUERY_PATTERNS.test(text) && !PAYMENT_LEAD_PATTERNS.test(text) && !looksLikeCashMovement(text)) {
    return { intent: 'query_cash', confidence: 0.9, entities, raw: text };
  }
  if (
    STOCK_QUERY_PATTERNS.test(text) &&
    !ORDER_PATTERNS.test(text) &&
    !SALE_PATTERNS.test(text) &&
    !PURCHASE_PATTERNS.test(text)
  ) {
    const color = extractSpokenColor(text);
    const size = extractSpokenSize(text);
    return {
      intent: 'query_stock',
      confidence: 0.86,
      entities: {
        ...entities,
        items: [
          {
            quantity: 1,
            rawText: text,
            productHint: entities.productName,
            attributes: { color, size },
          },
        ],
      },
      raw: text,
    };
  }
  if (PURCHASE_PATTERNS.test(text)) {
    return { intent: 'create_purchase', confidence: 0.8, entities, raw: text };
  }
  const explicitNewOrder =
    looksLikeNewOrder(text) ||
    ORDER_CREATE_PATTERNS.test(text) ||
    /^(un\s+)?(pedido|orden)[\s!¡?.]*$/i.test(text);
  if (
    explicitNewOrder &&
    !looksLikeQuestion(text) &&
    !looksLikeExistingOrderQuery(text) &&
    !looksLikeOrderStatusUpdate(text) &&
    !utteranceIsHowTo(text) &&
    !utteranceIsCapabilityQuestion(text) &&
    conversation?.awaiting !== STOCK_RESOLUTION_INTENT &&
    !isStockResolutionPending(conversation?.pendingIntent)
  ) {
    const count = expectedItemCountFromText(text);
    if (count) entities.expectedItemCount = count;
    if (isPlaceholderProductLabel(entities.productName)) {
      entities.productName = undefined;
      entities.spokenProductName = undefined;
    }
    if (entities.items?.length) {
      entities.items = entities.items.filter(
        (item) => !isPlaceholderProductLabel(item.rawText || item.productHint || item.productName)
      );
      if (!entities.items.length) {
        entities.items = undefined;
        entities.productName = undefined;
      }
    }
    return { intent: 'create_order', confidence: 0.86, entities, raw: text };
  }
  if (SALE_PATTERNS.test(text)) {
    return { intent: 'create_sale', confidence: 0.75, entities, raw: text };
  }
  if (PAYMENT_PATTERNS.test(text)) {
    return { intent: 'register_payment', confidence: 0.7, entities, raw: text };
  }
  if (BALANCE_PATTERNS.test(text)) {
    return { intent: 'query_balance', confidence: 0.7, entities, raw: text };
  }

  return pinFocusOrderToParsed(
    { intent: 'unknown', confidence: 0.2, entities, raw: text },
    conversation
  );
}

function parsePurchaseLines(raw: unknown): WhatsappPurchaseLine[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const lines: WhatsappPurchaseLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const productName = String(row.productName ?? row.nombre ?? '').trim();
    if (!productName) continue;
    const quantity = Math.max(
      1,
      parseInvoiceMoney(row.quantity ?? row.cantidad) || Number(row.quantity ?? row.cantidad) || 1
    );
    const unitCostNet = parseInvoiceMoney(row.unitCostNet ?? row.precioNeto ?? row.neto);
    const unitCostRaw = parseInvoiceMoney(row.unitCost ?? row.costoUnitario ?? row.costo);
    const unitCost = unitCostRaw || unitCostNet;
    const packFromModel = Number(row.packUnits ?? row.unidadesPorPack ?? row.pack) || 0;
    const packUnits = packFromModel >= 2 ? packFromModel : inferPurchasePackUnits(productName);
    const productId = String(row.productId ?? '').trim();
    const tipoRaw = String(row.tipoLinea ?? '').trim().toLowerCase();
    const tipoLinea = tipoRaw === 'insumo' ? ('insumo' as const) : tipoRaw === 'stock' ? ('stock' as const) : undefined;
    const skipped = row.skipped === true;
    lines.push({
      productName,
      invoiceName: String(row.invoiceName ?? productName).trim() || undefined,
      ...(productId ? { productId } : {}),
      quantity,
      unitCost,
      ...(unitCostNet > 0 ? { unitCostNet } : {}),
      ...(packUnits >= 2 ? { packUnits } : {}),
      ...(tipoLinea ? { tipoLinea } : {}),
      ...(skipped ? { skipped: true } : {}),
    });
  }
  return lines.length ? lines : undefined;
}

function parseExtraCosts(raw: unknown): ExtraCostItem[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const items: ExtraCostItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const data = row as Record<string, unknown>;
    const nombre = String(data.nombre ?? data.name ?? data.concept ?? '').trim() || 'Costo extra';
    const costo = Number(data.costo ?? data.cost ?? data.amount) || 0;
    if (!(costo > 0) && nombre === 'Costo extra') continue;
    items.push({ nombre: nombre.slice(0, 60), costo });
  }
  return items.length ? items : undefined;
}

function normalizeGeminiResult(
  parsed: {
    intent?: string;
    confidence?: number;
    entities?: Record<string, unknown>;
    followUpAction?: unknown;
    choiceIndex?: unknown;
    choiceIndexes?: unknown;
    conversationAction?: unknown;
    items?: unknown;
    client?: unknown;
  },
  raw: string,
  mediaId?: string | null
): ParsedWhatsappCommand {
  const followUpAction = parseFollowUpAction(parsed.followUpAction);
  const conversationAction =
    parseConversationAction(parsed.conversationAction) || followUpToConversationAction(followUpAction);
  const choiceIndexRaw = Number(parsed.choiceIndex);
  const choiceIndex =
    Number.isInteger(choiceIndexRaw) && choiceIndexRaw >= 1 && choiceIndexRaw <= 20
      ? choiceIndexRaw
      : undefined;
  const choiceIndexes = Array.isArray(parsed.choiceIndexes)
    ? parsed.choiceIndexes
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 20)
    : undefined;
  const extras = {
    ...(followUpAction ? { followUpAction } : {}),
    ...(choiceIndex ? { choiceIndex } : {}),
    ...(choiceIndexes?.length ? { choiceIndexes } : {}),
    ...(conversationAction ? { conversationAction } : {}),
  };

  const intent = (parsed.intent ?? 'unknown') as WhatsappIntent;
  if (!ALLOWED_INTENTS.includes(intent)) {
    return { intent: 'unknown', confidence: 0.3, raw, entities: mediaId?.trim() ? { mediaId } : {}, ...extras };
  }

  if (intent === 'help') {
    return { intent, confidence: Number(parsed.confidence) || 0.8, raw, ...extras };
  }
  if (intent === 'greeting') {
    return { intent, confidence: Number(parsed.confidence) || 0.8, ...extras };
  }

  const rawEntities = parsed.entities ?? {};
  if (parsed.client && typeof parsed.client === 'object' && !Array.isArray(parsed.client)) {
    const client = parsed.client as Record<string, unknown>;
    const rawName = typeof client.raw === 'string' ? client.raw.trim() : '';
    const givenName = typeof client.name === 'string' ? client.name.trim() : '';
    const complete = preferCompleteEntityName(rawName, givenName);
    if (complete) {
      rawEntities.clientName = complete;
      rawEntities.spokenClientName = rawName || complete;
    }
    if (!rawEntities.clientPhone && typeof client.phone === 'string') rawEntities.clientPhone = client.phone;
  }
  if (!rawEntities.items && parsed.items) rawEntities.items = parsed.items;
  const geminiItems = parseLineItems(
    parsed.items ??
      rawEntities.items ??
      (Array.isArray(rawEntities.orderItems) ? rawEntities.orderItems : undefined)
  );
  traceOrderItems('after-gemini', geminiItems);
  const entities: WhatsappCommandEntities = enrichEntitiesFromText(raw, {
    sourceText: raw.trim() || undefined,
    clientName:
      typeof rawEntities.clientName === 'string' ? rawEntities.clientName.trim() : undefined,
    spokenClientName:
      typeof rawEntities.spokenClientName === 'string'
        ? rawEntities.spokenClientName.trim()
        : undefined,
    clientPhone:
      typeof rawEntities.clientPhone === 'string'
        ? rawEntities.clientPhone.trim()
        : typeof rawEntities.telefono === 'string'
          ? rawEntities.telefono.trim()
          : undefined,
    productName:
      typeof rawEntities.productName === 'string'
        ? cleanedProductName(rawEntities.productName.trim())
        : undefined,
    spokenProductName:
      typeof rawEntities.spokenProductName === 'string'
        ? rawEntities.spokenProductName.trim()
        : typeof rawEntities.productName === 'string'
          ? rawEntities.productName.trim()
          : undefined,
    quantity:
      typeof rawEntities.quantity === 'number'
        ? rawEntities.quantity
        : Number(rawEntities.quantity) || undefined,
    amount: parseInvoiceMoney(rawEntities.amount) || undefined,
    notes: typeof rawEntities.notes === 'string' ? rawEntities.notes.trim() : undefined,
    paid: rawEntities.paid === true || String(rawEntities.paid).toLowerCase() === 'true',
    imageSummary:
      typeof rawEntities.imageSummary === 'string' ? rawEntities.imageSummary.trim() : undefined,
    mediaId: mediaId?.trim() || undefined,
    cashType:
      rawEntities.cashType === 'egreso' || rawEntities.cashType === 'ingreso'
        ? rawEntities.cashType
        : undefined,
    cashConcept:
      typeof rawEntities.cashConcept === 'string' ? rawEntities.cashConcept.trim() : undefined,
    cashAmbitoHint:
      typeof rawEntities.cashAmbitoHint === 'string'
        ? rawEntities.cashAmbitoHint.trim()
        : typeof rawEntities.cashAmbito === 'string'
          ? rawEntities.cashAmbito.trim()
          : typeof rawEntities.ambito === 'string'
            ? rawEntities.ambito.trim()
            : undefined,
    orderDate: coerceDateOnly(
      typeof rawEntities.orderDate === 'string' ? rawEntities.orderDate : undefined
    ),
    deliveryDate: coerceDateOnly(
      typeof rawEntities.deliveryDate === 'string' ? rawEntities.deliveryDate : undefined
    ),
    supplierName:
      typeof rawEntities.supplierName === 'string'
        ? rawEntities.supplierName.trim()
        : typeof rawEntities.proveedor === 'string'
          ? rawEntities.proveedor.trim()
          : undefined,
    invoiceNumber:
      typeof rawEntities.invoiceNumber === 'string'
        ? rawEntities.invoiceNumber.trim()
        : typeof rawEntities.numeroComprobante === 'string'
          ? rawEntities.numeroComprobante.trim()
          : undefined,
    paymentHint:
      typeof rawEntities.paymentMethod === 'string'
        ? rawEntities.paymentMethod.trim()
        : typeof rawEntities.paymentHint === 'string'
          ? rawEntities.paymentHint.trim()
          : undefined,
    paymentCuotas:
      typeof rawEntities.paymentCuotas === 'number'
        ? rawEntities.paymentCuotas
        : Number(rawEntities.paymentCuotas) || undefined,
    seniaAmount:
      typeof rawEntities.seniaAmount === 'number'
        ? rawEntities.seniaAmount
        : Number(rawEntities.seniaAmount) || undefined,
    orderStatus: parseOrderStatus(rawEntities.orderStatus),
    requestedStatus: parseOrderStatus(rawEntities.requestedStatus),
    collectionAmount:
      typeof rawEntities.collectionAmount === 'number'
        ? rawEntities.collectionAmount
        : Number(rawEntities.collectionAmount) || undefined,
    payFullBalance:
      rawEntities.payFullBalance === true ||
      String(rawEntities.payFullBalance).toLowerCase() === 'true',
    paymentKind: /^(se[ñn]a|senia|adelanto|anticipo)$/i.test(String(rawEntities.paymentKind ?? ''))
      ? 'senia'
      : String(rawEntities.paymentKind ?? '').toLowerCase() === 'pago'
        ? 'pago'
        : undefined,
    orderNumber:
      typeof rawEntities.orderNumber === 'string'
        ? rawEntities.orderNumber.trim()
        : typeof rawEntities.orderNumber === 'number'
          ? String(rawEntities.orderNumber)
          : undefined,
    referToLast: rawEntities.referToLast === true || String(rawEntities.referToLast).toLowerCase() === 'true',
    extraCosts: parseExtraCosts(rawEntities.extraCosts ?? rawEntities.costosExtra),
    items: intent === 'create_purchase' ? undefined : geminiItems,
    purchaseLines: parsePurchaseLines(
      rawEntities.purchaseLines ?? (intent === 'create_purchase' ? rawEntities.items : undefined)
    ),
  });
  if (entities.purchaseLines?.length) {
    entities.purchaseLines = grossUpPurchaseLinesIfVatSeparated(
      entities.purchaseLines,
      entities.amount
    );
  }
  if (!entities.items?.length && entities.productName) {
    const split = splitConcatenatedProductText(entities.productName);
    if (split.length) entities.items = split;
  }
  if (entities.items?.length) {
    ensureOrderItems(entities);
    syncLegacyProductFields(entities);
  }

  return {
    intent,
    confidence: Number(parsed.confidence) || 0.7,
    entities,
    raw,
    ...extras,
  };
}

function geminiAudioMime(contentType: string): string {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() || '';
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'audio/mp3';
  if (mime === 'audio/wav' || mime === 'audio/x-wav' || mime === 'audio/wave') return 'audio/wav';
  if (mime === 'audio/mp4' || mime === 'audio/aac' || mime === 'audio/x-m4a') return 'audio/aac';
  if (mime === 'audio/flac') return 'audio/flac';
  if (mime === 'audio/amr' || mime === 'audio/3gpp') return 'audio/amr';
  return 'audio/ogg';
}

function stripProductGuessFromStatus(entities: WhatsappCommandEntities): void {
  entities.productName = undefined;
  entities.spokenProductName = undefined;
  entities.items = undefined;
}

function pinFocusOrderToParsed(
  parsed: ParsedWhatsappCommand,
  conversation?: WhatsappParseConversation
): ParsedWhatsappCommand {
  const locked = lockedOrderFromFocus(conversation?.focusOrder);
  const raw = 'raw' in parsed ? String(parsed.raw ?? '') : '';
  if (
    parsed.intent === 'help' ||
    parsed.intent === 'greeting' ||
    parsed.intent === 'how_to' ||
    parsed.intent === 'capability_question'
  ) {
    return parsed;
  }

  const statusOnFocused =
    Boolean(locked) &&
    looksLikeOrderStatusUpdate(raw) &&
    !looksLikeNewOrder(raw) &&
    (parsed.intent === 'create_order' ||
      parsed.intent === 'create_sale' ||
      parsed.intent === 'unknown' ||
      parsed.intent === 'query_status');

  const next: ParsedWhatsappCommand = statusOnFocused
    ? {
        intent: 'update_order_status',
        confidence: Math.max(parsed.confidence, 0.9),
        entities: {
          ...('entities' in parsed ? parsed.entities ?? {} : {}),
          orderStatus:
            ('entities' in parsed ? parsed.entities?.orderStatus : undefined) ||
            orderStatusFromText(raw),
          sourceText: raw,
        },
        raw,
        conversationAction: parsed.conversationAction === 'new_task' ? 'new_task' : parsed.conversationAction,
      }
    : parsed;

  if (!locked) return next;
  if (
    next.intent !== 'update_order_status' &&
    next.intent !== 'register_payment' &&
    next.intent !== 'query_status' &&
    next.intent !== 'query_balance'
  ) {
    return next;
  }
  const entities = applyOrderLock('entities' in next ? next.entities ?? {} : {}, locked, raw);
  if (next.intent === 'update_order_status') stripProductGuessFromStatus(entities);
  return { ...next, entities };
}

function adoptStockResolutionIfAwaiting(
  parsed: ParsedWhatsappCommand,
  text: string,
  conversation?: WhatsappParseConversation
): ParsedWhatsappCommand {
  if (
    conversation?.awaiting !== STOCK_RESOLUTION_INTENT &&
    !isStockResolutionPending(conversation?.pendingIntent)
  ) {
    return parsed;
  }
  if (looksLikeNewOrder(text) || looksLikeCashMovement(text)) return parsed;
  if (parsed.intent === 'help' || parsed.intent === 'greeting') return parsed;

  const fromEntities =
    'entities' in parsed
      ? parsed.entities?.stockResolution || actionFromParsedScope(parsed.entities?.descuentoFisicoAlcance)
      : undefined;
  const choice = interpretStockResolutionFromText(text);
  const action = fromEntities || choice.action;
  const stealingCreate =
    parsed.intent === 'create_order' ||
    parsed.intent === 'create_sale' ||
    parsed.intent === 'unknown';

  if (!stealingCreate && parsed.intent === 'update_order_status') {
    if (!action) return parsed;
    const entities = { ...('entities' in parsed ? parsed.entities ?? {} : {}) };
    entities.stockResolution = action;
    entities.descuentoFisicoAlcance = scopeFromStockResolution(action);
    entities.productName = undefined;
    entities.spokenProductName = undefined;
    entities.items = undefined;
    entities.referToLast = true;
    return {
      ...parsed,
      conversationAction: action === 'cancel' ? 'cancel_current' : 'answer_current',
      entities,
    };
  }

  if (!stealingCreate) return parsed;

  return pinFocusOrderToParsed(
    {
      intent: 'update_order_status',
      confidence: Math.max(parsed.confidence, 0.9),
      conversationAction: action === 'cancel' ? 'cancel_current' : 'answer_current',
      entities: {
        ...('entities' in parsed ? parsed.entities ?? {} : {}),
        productName: undefined,
        spokenProductName: undefined,
        items: undefined,
        stockResolution: action ?? undefined,
        descuentoFisicoAlcance: scopeFromStockResolution(action),
        referToLast: true,
      },
      raw: text,
    },
    conversation
  );
}

function actionFromParsedScope(
  scope: string | undefined
): 'discount_full_order' | 'discount_reserved' | 'cancel' | undefined {
  if (scope === 'pedido_completo' || scope === 'discount_full_order') return 'discount_full_order';
  if (scope === 'solo_reservado' || scope === 'discount_reserved') return 'discount_reserved';
  if (scope === 'cancel') return 'cancel';
  return undefined;
}

async function parseWithGemini(input: WhatsappParseInput): Promise<ParsedWhatsappCommand | null> {
  try {
    const hasAudio = Boolean(input.audio?.buffer?.length);
    const hasImage = Boolean(input.image?.buffer?.length);
    const message =
      input.text.trim() ||
      (hasAudio ? '(sin texto, solo audio de WhatsApp)' : hasImage ? '(sin texto, solo imagen)' : '');
    const copy = whatsappCopyForRubro(input.rubro);
    let memoryBlock = '';
    if (input.businessId) {
      try {
        const memory = await loadOperatorMemory(input.businessId);
        memoryBlock = formatOperatorMemoryPrompt(memory);
      } catch (error) {
        console.warn('[whatsapp] operator memory load failed:', error);
      }
    }
    if (input.conversation?.languageMemory) {
      const spoken = formatLanguageMemoryPrompt(input.conversation.languageMemory);
      if (spoken) memoryBlock = [memoryBlock, spoken].filter(Boolean).join('\n');
    }
    const productRule = copy.hasProductExamples
      ? `- items[]: cada producto es un renglón aparte (quantity, rawText, productHint, attributes). Ejemplo de un ítem: «${copy.exampleProduct}». No concatenes varios productos. No pongas fecha ni cliente dentro de rawText.`
      : '- items[]: cada producto es un renglón aparte. Conservá talle/color/tela en attributes. No concatenes varios productos. No pongas fecha ni cliente dentro de rawText.';
    const conversation = input.conversation;
    const lastOp = conversation?.lastOperation;
    const focus = conversation?.focusOrder;
    const inProgress = Boolean(
      conversation?.pendingIntent || conversation?.awaiting || conversation?.originalIntent
    );
    const thread = (conversation?.turns ?? [])
      .filter((turn) => String(turn.text ?? '').trim())
      .slice(-8)
      .map((turn) => `${turn.role === 'bot' ? 'bot' : 'dueño'}: ${String(turn.text).slice(0, 280)}`)
      .join('\n');
    const focusLine = focus?.id
      ? `- Pedido EN FOCO (de ESTE chat, más importante que el último guardado): #${focus.label || ''} ${focus.clientName || ''} id=${focus.id}${focus.status ? ` estado=${focus.status}` : ''}. «ponelo», «movelo», «move el pedido», «saldalo», «eso», «ese», «este pedido», «el pedido», «el saldo de este pedido», «cuánto es el saldo», «cambiale el estado» SIN nombrar OTRO cliente = ESTE pedido. Copiá targetOrderId="${focus.id}", targetOrderLabel="${focus.label || ''}", clientName="${focus.clientName || ''}". referToLast=false. conversationAction=new_task si cambia estado/cobro sobre ese pedido. NUNCA uses el último guardado de otro cliente. NUNCA create_order. NUNCA productName ni productHint a partir de «move», «el pedido», «estado» o «entregado».`
      : '';
    const lastOpLine = lastOp?.id
      ? `- Última operación COMPLETADA: ${[lastOp.kind, lastOp.label ? '#' + lastOp.label : '', lastOp.clientName, lastOp.status]
          .filter(Boolean)
          .join(' ')}. El foco conversacional sigue en esa entidad aunque activeTask esté vacío.`
      : '';
    const idleFocusRule =
      focus?.id && !inProgress
        ? `- Sin tarea abierta, PERO hay pedido en foco. «move el pedido a estado entregado», «movelo a entregado», «ponelo listo», «pasalo a entregado», «marcalo entregado», «el pedido que hicimos recién ponelo entregado» → intent=update_order_status, orderStatus=entregado|listo, targetOrderId del foco, conversationAction=new_task. NO create_order. NO productName. Si nombra OTRO cliente («el de Juan», «buscame el de Pedro»), no uses el foco.`
        : '';
    const awaitingStock =
      conversation?.awaiting === STOCK_RESOLUTION_INTENT ||
      isStockResolutionPending(conversation?.pendingIntent);
    const stockDecisionBlock = awaitingStock
      ? `
DECISIÓN PENDIENTE DE STOCK (prioridad absoluta):
- TAREA ACTIVA: cambiar el estado del pedido en foco (${focus?.label ? '#' + focus.label : 'el actual'}). NO es un pedido nuevo.
- El ERP pidió cómo descontar stock (no hay reservas, o hay que elegir alcance).
- Opciones típicas: descontar todo el pedido (discount_full_order) o cancelar. A veces también solo lo reservado.
- El mensaje del dueño responde ESA pregunta. conversationAction=answer_current. intent=update_order_status.
- entities.stockResolution: discount_full_order | discount_reserved | cancel
- «desconta el total del pedido», «descontá todo», «todo el pedido», «sacalo todo del stock», «baja todas las cantidades», «el total», «todo», «sí» (si preguntamos SÍ/NO de descontar todo) → stockResolution=discount_full_order
- «no», «cancelá», «dejalo», «no cambies nada», «dejalo como estaba» → stockResolution=cancel, conversationAction=cancel_current
- NUNCA create_order. NUNCA create_sale. NUNCA productName/productHint a partir de «descontá», «total», «pedido», «stock», «unidades».
- No pidas cliente, producto ni precio.
- Si ADEMÁS pregunta el saldo/estado («y después decime cuánto saldo tiene»), resolvé stockResolution Y dejá claro que también consulta el mismo pedido (referToLast=true). No descartes esa parte.
- new_task SOLO si empieza otra operación clara (egreso de caja, compra, pedido NUEVO de un cliente).
`
      : '';
    const conversationBlock = `
ESTE ES UN CHAT CONTINUO, no mensajes sueltos. Cada dueño habla distinto (typos, «ponelo», «saldalo», «ese», «el de Cardozo»). Interpretá ESTE mensaje en el hilo.
${thread ? `- Últimos mensajes:\n${thread}` : ''}
${focusLine}
${conversation?.pendingPrompt ? `- Lo último que preguntó el bot: ${String(conversation.pendingPrompt).slice(0, 280)}` : ''}
${stockDecisionBlock}
${inProgress
  ? `- Operación en curso: ${conversation?.originalIntent || conversation?.pendingIntent || 'desconocida'}
- Esperábamos: ${conversation?.awaiting || 'más datos'}
- Datos ya cargados (NO los pises salvo corrección explícita): ${JSON.stringify(compactKnownEntities(conversation?.knownEntities))}
- Campos que faltaban: ${(conversation?.missingKeys ?? []).join(', ') || 'ninguno'}
${conversation?.candidates?.length ? `- Opciones numeradas: ${conversation.candidates.map((c) => `${c.index}) ${c.label}`).join(' · ')}` : ''}
- followUpAction: continue | choose | confirm | cancel | new | ask | correct
- conversationAction: continue_current | new_task | correct_current | cancel_current | confirm_current | answer_current
- choiceIndex: si choose, el número 1-based. «el primero»=1, «ese»=1, «los dos»=choiceIndexes:[1,2]
- Si corrige el resumen (estado, monto, «saldalo», «ponelo entregado», «no, la segunda es L») → correct o continue, NUNCA new. new SOLO si cambia de cliente o de tipo (pedido nuevo, compra, egreso).
- En entities devolvé campos nuevos o corregidos. Si el foco tiene pedido, incluí targetOrderId.
- Si agregás un producto a un pedido en curso, devolvé items con TODOS los renglones (los anteriores + el nuevo). Nunca pises los ya cargados.
- Un mensaje puede responder la pregunta Y aportar más datos («negra y para el viernes»). Extraé ambos.
- choose SOLO si eligió de forma explícita: un número solo, «el 1», «ese». Si pregunta → ask.
- Si esperábamos confirmación: confirm SOLO si dijo sí/ok/dale y no cambió datos. Si corrige → correct.
- Si esperábamos deliveryDate: «mañana» y typos son la fecha, nunca un producto. Si también agrega un ítem, extraé items.
- Si esperábamos extraCosts: el costo extra INTERNO (estampado $150) o NO. extraCosts es costo de producción, NUNCA se suma al precio de venta ni al saldo. Si dice SÍ sin el importe, pedí de nuevo el mismo dato (concepto e importe). No hay un segundo paso.
- Si esperábamos notes / descripción: el mensaje ENTERO es notes (frase del estampado, «en el talle L…», nombre del bebé, observaciones). followUpAction=continue. Poné notes=texto completo. NUNCA productName. NUNCA pises el producto ni el cliente ya cargados. NUNCA ofrezcas crear un producto.`
  : `- followUpAction: omitilo si es un mensaje nuevo, salvo que el foco deje claro que sigue el mismo pedido (entonces continue).`}
${lastOpLine}
${idleFocusRule}
`;
    const prompt = `Eres el intérprete conversacional de RiloBot.

Tu función es comprender exactamente qué quiere hacer el usuario.

Los usuarios hablan español natural, especialmente español rioplatense,
pueden cometer errores de ortografía, usar abreviaciones, omitir palabras,
escribir varias instrucciones juntas y responder de forma contextual.

No exijas comandos exactos.

Interpretá el mensaje completo.

Primero determiná si el usuario está:
- ejecutando una acción,
- continuando una acción,
- corrigiendo,
- contestando una pregunta,
- preguntando cómo usar una función,
- preguntando si una función existe,
- cancelando,
- o iniciando una tarea nueva.

No confundas preguntas sobre cómo hacer algo con solicitudes para ejecutarlo.
No conviertas texto desconocido automáticamente en un producto.
Solo extraigas productos cuando el intent requiera productos.
Una instrucción explícita nueva puede reemplazar un contexto pendiente viejo.
Si el usuario utiliza una referencia implícita como «pasalo», «movelo», «ese pedido», resolvela primero contra el foco conversacional.
Si no hay certeza, intent=unknown. NUNCA asumas create_order porque no entendiste.

Una respuesta puede contestar la pregunta pendiente y aportar información adicional.

Nunca descartes partes del mensaje.

No inventes datos del ERP.

No inventes clientes, productos, precios, saldos, estados ni IDs.

Separá semánticamente cliente, items, atributos, descripción, fechas,
pagos, costos y estado.

Una frase puede contener múltiples productos y múltiples acciones.

Las correcciones modifican únicamente aquello que el usuario corrigió.

La información confirmada previamente debe conservarse.

La memoria del usuario es una ayuda, no una verdad absoluta.

Si una interpretación tiene varias posibilidades razonables, marcala como ambigua.

Si falta un dato obligatorio, indicá cuál falta.

No ejecutes ninguna acción.

Devolvé únicamente el structured output solicitado.

Si hay imagen, usala como referencia (pedido, venta o compra a proveedor).
Si hay audio, transcribilo al español (rioplatense) y clasificá lo que dijo. No inventes palabras que no se oigan.
Devolvé SOLO JSON válido con:
- intent: help|how_to|capability_question|greeting|create_order|create_sale|create_purchase|register_payment|query_balance|query_cash|query_status|query_stock|register_cash|create_client|register_cost|update_product_cost|update_order_status|unknown
- confidence: 0-1
- conversationAction: continue_current|new_task|correct_current|cancel_current|confirm_current|answer_current
- transcript: si hay audio, la transcripción literal. Si no se entiende, string vacío.
- followUpAction, choiceIndex, choiceIndexes (opcionales)
- items: ARRAY de renglones independientes para create_order, create_sale y create_purchase. Cada ítem: { quantity, rawText, productHint, attributes: { type, fabric, model, color, size } }. UNA frase con varios productos = VARIOS items. Nunca un solo productName con «1 X y 1 Y».
- entities: objeto opcional con clientName, clientPhone, supplierName, productName (solo si hay UN ítem; si hay varios usá items[]), quantity, amount (número), notes, paid (boolean), requestedStatus (pendiente|en_produccion|listo|entregado, SOLO si lo pidió con ponelo/pasalo/dejalo), imageSummary, cashType (ingreso|egreso), cashConcept, cashAmbitoHint (nombre de caja: personal, negocio, la mía), orderDate (YYYY-MM-DD), deliveryDate (YYYY-MM-DD), invoiceNumber, purchaseLines (array de { productName, quantity, unitCost, unitCostNet, packUnits } para compras), paymentMethod (efectivo|transferencia|debito|mercado_pago|tarjeta|proveedor si se ve o lo dijo), paymentCuotas (número), paymentKind (seña|pago), seniaAmount (número), orderStatus (pendiente|en_produccion|listo|entregado; en create_order usá requestedStatus, no orderStatus), payFullBalance (boolean), listOrders (boolean), orderNumber, referToLast (boolean), extraCosts (array de { nombre, costo }), stockResolution (discount_full_order|discount_reserved|cancel si hay decisión de stock pendiente), descuentoFisicoAlcance (pedido_completo|solo_reservado)

Reglas:
- greeting: solo un saludo corto (hola, buenas), sin pedido de ayuda.
- help: SOLO si pregunta cómo funciona, qué puede hacer, o escribe «consultame» / «ayuda» / «qué productos hay» / «cómo hago un pedido». Si pide registrar un pedido, venta o compra, NO es help aunque diga la palabra «producto».
${productRule}
- client: { raw, name, phone }. raw = texto LITERAL del cliente como lo dijo, INCLUYENDO guiones, paréntesis, @, números y apodos. NO cortes el nombre en un signo ni en un sufijo corto. name puede ser una forma más limpia, pero raw no se pierde. El backend busca primero el candidato completo.
- clientName: si no usás client.raw, poné el nombre completo igual (nombre y apellido y cualquier sufijo que haya dicho). NUNCA un verbo (ingresa, registra, carga), un día de la semana, «hoy», «mañana», un color o un talle. «para el jueves/viernes/...» NO es un cliente.
- Ejemplo: «pedido del cliente Ana-Rosa (local) @tienda un buzo XL» → client.raw="Ana-Rosa (local) @tienda", clientName="Ana-Rosa (local) @tienda". No dejes solo «Ana-Rosa».
- create_client: solo dar de alta un cliente, sin pedido/venta/cobro. Ej: «registrar cliente María Pérez», «nuevo cliente Juan», «cargar cliente». Si dice teléfono, clientPhone. Si solo dice «registrar cliente» sin nombre, igual create_client.
- Ejemplo: «ingresa el pedido de danyelyn camiseta xl roja de algodon $620 costo $100 descripcion estampado a3 adelante» → create_order, clientName="danyelyn", items=[{quantity:1, rawText:"camiseta xl roja de algodon", productHint:"camiseta algodon", attributes:{type:"camiseta", fabric:"algodon", size:"XL", color:"rojo"}}], amount=620, extraCosts=[{nombre:"Costo extra", costo:100}], notes="estampado a3 adelante". NUNCA uses register_cost. NUNCA pongas el verbo (ingresa, registra, carga) como clientName.
- create_order: pedido NUEVO a registrar. Extraé TODO lo que esté en la frase. Si solo dice «pedido» para EMPEZAR uno, create_order con entities vacías. Si PREGUNTA por un pedido que ya existe («este pedido», «el saldo», «cuánto es»), es query_status, NUNCA create_order.
- how_to: pregunta CÓMO hacer algo («¿cómo te paso 30 productos?», «qué datos necesitás para un pedido?»). helpTopic=create_order|create_sale|.... expectedItemCount si dijo un número. NO ejecutes. NO pidas precio. NO inventes un producto.
- capability_question: pregunta SI SE PUEDE («puedo mandarte un pedido con 30 productos?»). NO es create_order.
- «quiero registrar un pedido de 30 productos, ¿cómo te paso la info?» → how_to, helpTopic=create_order, expectedItemCount=30. NUNCA create_order.
- «registrame un pedido de 30 productos para María» → create_order, clientName=María, expectedItemCount=30, SIN productName=«30 productos». El dueño va a mandar los ítems después.
- «pásalo / pasalo / movelo / ponelo a estado entregado» → update_order_status. NUNCA productName. NUNCA create_order.
- MULTI-ÍTEM OBLIGATORIO: «1 camiseta dry coll talle L blanca y 1 camiseta dry coll talle XL al cliente Yovana 098828757» → create_order, clientName="Yovana", clientPhone="098828757", items=[{quantity:1, rawText:"camiseta dry coll talle L blanca", productHint:"camiseta dry cool", attributes:{type:"camiseta", fabric:"dry cool", size:"L", color:"blanco"}},{quantity:1, rawText:"camiseta dry coll talle XL", productHint:"camiseta dry cool", attributes:{type:"camiseta", fabric:"dry cool", size:"XL"}}]. NUNCA concatenes los dos productos en un solo productName.
- Ejemplo: «Pedido para Lizzy Berneda, camiseta algodón talle S, $550. Descripción diseño adelante KATSEYE» → clientName="Lizzy Berneda", items=[{quantity:1, rawText:"camiseta algodón talle S", attributes:{type:"camiseta", fabric:"algodon", size:"S"}}], amount=550, notes="diseño adelante KATSEYE".
- Ejemplo: «Registra un pedido a Leticia Martinez, producto estampado a $250. Costo $100. sin descripcion» → create_order, clientName="Leticia Martinez", items=[{quantity:1, rawText:"estampado", productHint:"estampado"}], amount=250, extraCosts=[{nombre:"Costo extra", costo:100}], notesAsked (sin descripción). amount es el precio de venta ($250), no el costo.
- Si dice «Producto es camiseta algodón rosa talle S para el miércoles que viene»: items con productHint="camiseta algodón rosa talle S" (sin «Producto es» ni la fecha), deliveryDate=el miércoles.
- Campos ausentes: OMITILOS. No pongas null ni string vacío: eso borra datos ya cargados.
- deliveryDate: opcional. «entrega el viernes», «para el jueves», «el jueves», «20/08», «20 de agosto», «lo necesito hoy». Si no la dijo, OMITILA: nunca inventes hoy ni otra fecha. LISTO no significa hoy. Si el follow-up trae fecha Y otro dato (diseño, color, cliente), extraé TODO.
- Preguntá solo lo que falte. Si ya está el cliente, el producto, el total y el pago, no los vuelvas a pedir. No asumas fecha de entrega.
- orderDate: fecha de carga si la mencionó; si no, no inventes (queda hoy).
- create_purchase: compra a proveedor, remito, factura. Extraé supplierName, invoiceNumber, orderDate, purchaseLines (TODAS) y amount = TOTAL CON IVA. La compra SOLO registra el comprobante y suma stock: NO asienta caja y NO cambia el costo configurado del producto. No pongas paymentMethod salvo que lo pidan aparte. Egreso de caja = register_cash en OTRO mensaje. Costo de catálogo = update_product_cost en OTRO mensaje.
- Foto de factura/e-Ticket/remito (RUT, IVA, razón social, ítems): SIEMPRE create_purchase. El proveedor es el EMISOR (logo / razón social de quien factura: ej. «disershop MAYORISTA» / Diser SAS), nunca el cliente / CONSUMO FINAL / el nombre de quien recibe.
- Cómo leer un e-Ticket uruguayo (como una tabla, ítem por ítem):
  1) supplierName = marca o razón social de ARRIBA (disershop, no Loreley).
  2) invoiceNumber = número del comprobante (A-1638046).
  3) Cada renglón: productName LITERAL completo (modelo + color + talle: «Canguro Felpa SW Rojo L», «Camiseta Oversize Negro M»). No acortes ni lo traduzcas al catálogo.
  4) quantity = columna cantidad (4.00 → 4).
  5) unitCostNet = precio UNITARIO NETO de la columna (36,07). unitCost = ese neto × 1,22 si IVA 22% (o × 1,10 si IVA 10%). Nunca dejes el costo sin IVA. No uses el total de la línea como unitCost.
  6) packUnits: si la descripción dice «x2 $99 c/u» / pack, packUnits=2. quantity sigue siendo la del renglón (2), no multipliques todavía.
  7) amount = TOTAL del pie (4.015), no el neto.
- Ejemplo e-Ticket: emisor disershop, ítem «Canguro Felpa SW Rojo L» cant 2, unitario neto 490,98, IVA 22% → productName="Canguro Felpa SW Rojo L", quantity=2, unitCostNet=490.98, unitCost=599.00. Ítem «Jarra cervecera esmerilada 16oz x2 $99c/u» cant 2, neto 162,30 → packUnits=2, unitCostNet=162.30, unitCost=198.01.
- Extraé todas las líneas aunque sean 10 o más. El match con el ERP se hace después, preguntando: no inventes el nombre del catálogo.
- Si hay foto de factura/remito/ticket de proveedor (CUIT/RUT, IVA, razón social, ítems con costo), preferí create_purchase.
- Si hay foto de pedido/lista de cliente y no está claro, preferí create_order.
- notes: SOLO el diseño/observación del pedido. Cortá el campo cuando empiece pago, importe, fecha, cliente o estado. «canguro XL rojo con diseño de ceibal ya está pago $1550» → notes="Ceibal", amount=1550, paid=true. NUNCA notes="Ceibal ya está pago $1550". NUNCA copies el mensaje entero. Si no hay descripción real, omití notes.
- paid: true si dijo que ESTE pedido nuevo ya está pago/cobrado/saldado. Eso es un cobro + saldo + ingreso de caja, NO un estado. NUNCA pongas orderStatus=listo/entregado/pagado por un pago.
- requestedStatus: SOLO si pidió explícitamente un estado con un verbo de cambio (ponelo listo, dejalo pendiente, pasalo a entregado). «ya está pago» NO es requestedStatus.
- extraCosts: costo INTERNO de producción (estampado $200, «estampado me cuesta $150», sumale 200 de estampado). amount es el precio de venta al cliente; NO sumes el extra a amount ni al cobro ni al saldo. extraCostsProductHint si dijo a qué prenda («al canguro»).
- Un mismo mensaje puede traer varias acciones a la vez: create_order + paid + extraCosts + requestedStatus. Extraé TODAS. No descartes ninguna parte.
- No inventes clientes, proveedores ni montos si no aparecen.
- query_cash: cuánto hay en caja AHORA (saldo neto de cada caja) o el resumen de HOY si lo pidió. Ej: «¿cuánto tengo como saldo neto?», «saldo neto de las cajas», «cuánto hay en caja», «caja de hoy», «cuánto vendí». NO es saldo de un cliente (eso es query_balance) ni un ingreso/egreso (register_cash).
- query_balance: saldo que DEBE un cliente. Hace falta el nombre: «saldo de Pedro», «cuánto debe María». Si habla de cajas / saldo neto sin cliente, es query_cash. Si pregunta el saldo DE UN PEDIDO («el saldo de este pedido», «cuánto queda del 220»), es query_status, no query_balance.
- query_stock: cuántas unidades hay en depósito. Ej: «cuántas negras XL tengo», «stock de dry cool blanca L», «cuánto hay de remeras». Extraé productHint + attributes.color/size. NO es create_order. Un follow-up «y L?» o «y Pedro?» lo resuelve el backend con lastQuery; si ves un follow-up de stock, intent=query_stock con solo el campo que cambió.
- query_status: consultar un pedido/venta ya guardado. NO es create_order ni create_purchase. Ejemplos: «¿en qué estado lo registraste?», «qué pidió Lizzy», «mostrame el pedido de Cardozo», «el pedido de Lizzy», «pedido #00223», «el último», «y el saldo de este pedido cuanto es?». clientName si nombra a alguien de verdad, NUNCA «este»/«ese». orderNumber si hay número o si el hilo acaba de nombrar uno (#00220). referToLast=true solo si habla de lo último / lo / eso / este pedido SIN nombre. Si pide LISTAR o BUSCAR («listame pedidos», «mostrame el pedido de Cardozo», «buscá el oversize de Sergio»), listOrders=true, clientName/productName si los nombra, referToLast=false. NUNCA uses el último pedido de otro cliente. El sistema lista solo pedidos NO entregados, salvo que pida entregados o todos. Si dice «que no esté entregado» / abiertos / pendientes, no pongas productName=entregado. Si no hay match, no inventes: el sistema pide producto, monto o estado.
- Ejemplo: el hilo habla del pedido #00220 y el dueño dice «y el saldo de este pedido cuanto es?» → query_status, orderNumber="220". Sin clientName="este". Sin productName. NUNCA create_order.
- register_payment: el cliente entregó plata por algo YA guardado (seña, adelanto, anticipo, a cuenta, cuota, saldo, «me pagó», «cobré»). clientName, amount = lo que entregó, paymentKind="seña" si es seña/adelanto/anticipo/a cuenta o el primer pago, si no "pago". paymentMethod si dijo cómo (transferencia, efectivo, mercado pago). orderNumber si nombró el pedido; referToLast=true si dice «ese pedido», «el último», «lo que acabo de cargar». Si no nombra cliente ni número («me llegó un pago», «me pagaron 500», «llegó una transferencia»), igual register_payment: amount si hay monto, sin clientName. El sistema pregunta si es cobro de pedido o ingreso suelto. NO es register_cash salvo que diga egreso/gasto/salida de caja o ingreso de caja. NO es create_order.
- Ejemplos de register_payment: «Danyelyn me dejó $200 de seña» → clientName="Danyelyn", amount=200, paymentKind="seña". «seña de 300 del pedido 223 por transferencia» → amount=300, paymentKind="seña", orderNumber="223", paymentMethod=transferencia. «cobré 500 a Lizzy» → amount=500, paymentKind="pago". «me abonó el resto» sin monto → register_payment igual, sin amount (se lo pregunto). «me llegó un pago de 500» → amount=500, sin clientName. «saldalo» → payFullBalance=true.
- OJO: si en el mismo mensaje ARMA un pedido nuevo y además dice que YA está pagado/cobrado/saldado («pagado $1550», «ya pagó», «cobrado», «saldado»), es create_order con amount=total y paid=true. Eso genera un cobro RELACIONADO al pedido nuevo (saldo 0 si pagó el total). NO cambies a register_payment. NO pongas orderStatus ni requestedStatus por el pago: el estado inicial lo pone el ERP.
- Ejemplo: «registrame un pedido de un canguro rojo XL por $1550, ya está pago y ponelo listo» → create_order, paid=true, amount=1550, requestedStatus="listo". El pago no es Entregado.
- Ejemplo: «el pedido quedó listo y danyelyn ya pagó» → update_order_status, clientName="danyelyn", orderStatus="listo", paid=true, payFullBalance=true. El pago no cambia el estado a entregado.
- OJO: si en el mismo mensaje ARMA un pedido nuevo y además dice que dejó seña («pedido para Ana, buzo $1500, señó $500»), es create_order con amount=1500 y seniaAmount=500. La seña se cobra al guardar el pedido. Solo es register_payment si el pedido ya existía.
- seniaAmount: plata que dejó junto con el pedido («señó 500», «dejó $200 de seña», «con un adelanto de 300»). NUNCA la pongas en amount (amount es el precio de venta) ni en extraCosts.
- update_order_status: el dueño AVISA que un pedido ya guardado avanzó. «quedó listo», «lo terminé», «ya está pronto» → orderStatus="listo". «lo estoy haciendo», «empecé» → "en_produccion". «se lo entregué», «lo retiró», «ya lo llevó», «pasalo a entregado», «pasalo a estado entregado» → "entregado". orderNumber si lo nombra, clientName si nombra al cliente, referToLast=true si dice «ese» / «el último». NO es query_status (eso es PREGUNTAR cómo está).
- Ejemplo: acaba de quedar un pedido en foco (#00245, Laissmachado) y dice «move el pedido a estado entregado» → update_order_status, orderStatus="entregado", targetOrderId del foco. NUNCA create_order. NUNCA productHint="move el entregado".
- «pasalo a estado entregado» / «ponelo como entregado» / «cambialo a entregado» es entregado aunque el pedido ya esté Listo. NO lo dejes en listo. NO copies un monto de un mensaje anterior. NO cobres el saldo salvo que diga que pagó / saldalo / cobra el saldo / cobra todo el saldo / ya pagó.
- Si además avisa que le pagó todo o que COBRE el saldo («y ya pagó», «me pagó todo», «quedó saldado», «cobra todo el saldo», «cobra el saldo») → paid=true, payFullBalance=true. Cobra el saldo que faltaba. El estado es el que pidió (entregado si dijo entregado; listo si dijo listo).
- Ejemplo: «el pedido quedó listo y danyelyn ya pagó» → update_order_status, clientName="danyelyn", orderStatus="listo", paid=true, payFullBalance=true.
- Ejemplo: «El pedido de Sergio pasalo a estado entregado» → update_order_status, clientName="Sergio", orderStatus="entregado". Sin amount, sin paid.
- Ejemplo: «cambialo a entregado y cobra todo el saldo» → update_order_status, orderStatus="entregado", paid=true, payFullBalance=true. SIN amount. NUNCA omitas el cobro si dijo cobra/saldalo.
- Ejemplo: «el pedido 220 movelo a estado entregado y deja el saldo en cero, o sea registra el pago total» → update_order_status, orderNumber="220", orderStatus="entregado", paid=true, payFullBalance=true.
- Ejemplo: «pasa el pedido a listo y registra el pago del total del saldo» → update_order_status, orderStatus="listo", paid=true, payFullBalance=true. NO es entregado: cobra el saldo y deja el estado en listo.
- payFullBalance: true si dijo cobra todo el saldo, cobra el saldo, pagó TODO, el resto, el total del saldo, «saldalo» o «registrá el pago del total», sin un monto puntual.
- register_cash: gasto/egreso o ingreso MANUAL de caja, en un mensaje aparte de la compra. Coloquial: «hacé un egreso de caja por 4015 en personal», «egreso 500 en personal», «registrá un egreso de la caja de rilo por $6000 por motivo pago tarjeta pronto», «sacá 200 de caja del negocio», «ingreso 2000 a caja del negocio», «gasto 500 flete», «meté 3000 en caja», «registrá una salida de caja descripción Pronto $6000». cashType=egreso|ingreso, amount, cashConcept (para qué: flete, Pronto, sueldo, pago tarjeta). cashAmbitoHint = cómo nombró la caja (personal, rilo, negocio, la mía). «de la caja de X» es ESA caja, NO una consulta de saldo. Si no nombró caja, OMITÍ cashAmbitoHint. NO es query_cash. NO es create_purchase aunque diga «compra» en el concepto. NO es cobro de un pedido (register_payment) ni create_order: «ingresa el pedido» es create_order, «ingreso 2000» / «hacé un ingreso» es register_cash. Un egreso NUNCA se copia después como cobro de un pedido.
- update_product_cost: cambiar el costo CONFIGURADO de un producto del catálogo. productName + amount = nuevo costo. Ej: «el costo de Taza AA es 147», «cambiá el costo de Canguro felpa Rojo L a 600». NO es register_cost (eso es extra de un pedido) ni create_purchase.
- register_cost: agregar un ítem de costo extra a un pedido YA guardado (estampado, vinilo, personalización, «sumale al costo»). NO es un gasto de caja ni una compra a proveedor ni un pedido nuevo ni el costo de catálogo. Ejemplos: «en el pedido nro 223 sumale al costo $200», «pedido #00223 sumale 200 al costo», «costo estampado 200», «agregá costo vinilo 150 al pedido de Carola», «al último pedido costo de serigrafía 80». extraCosts = [{ nombre, costo }]. orderNumber si hay número. clientName si nombra a alguien. referToLast=true solo si habla del último y no da número. Si en el mismo mensaje arma un pedido nuevo («pedido para…», «ingresa el pedido de…», «registrá un pedido…»), usá create_order y poné extraCosts en ese pedido.
- Si en un create_order menciona un costo extra («pedido para Ana, buzo 1500, costo estampado 200»), extraCosts va en el pedido; amount es el precio de venta, no el costo.
- La memoria del usuario es una ayuda, no una verdad absoluta. Si el mensaje actual contradice la memoria, manda el mensaje actual.
- Si una interpretación tiene varias posibilidades razonables, marcá requiresClarification=true y clarificationReason. No elijas un id de catálogo: el backend resuelve.
${conversationBlock}
${memoryBlock ? `\n${memoryBlock}\n` : ''}
Mensaje: ${JSON.stringify(message)}`;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
    ];

    if (input.image?.buffer?.length) {
      const mimeType = input.image.contentType.startsWith('image/')
        ? input.image.contentType
        : 'image/jpeg';
      parts.push({
        inlineData: {
          mimeType,
          data: input.image.buffer.toString('base64'),
        },
      });
    }

    if (input.audio?.buffer?.length) {
      parts.push({
        inlineData: {
          mimeType: geminiAudioMime(input.audio.contentType),
          data: input.audio.buffer.toString('base64'),
        },
      });
    }

    const timeoutMs = hasImage ? 40000 : hasAudio ? 25000 : input.conversation ? 18000 : 15000;
    const parsed = (await generateGeminiJson({
      parts,
      timeoutMs,
      label: 'parser',
      businessId: input.businessId,
      tool: 'parser',
      responseSchema: GEMINI_TURN_SCHEMA as unknown as Record<string, unknown>,
      validate: isValidTurnJson,
    })) as {
      intent?: string;
      confidence?: number;
      transcript?: string;
      entities?: Record<string, unknown>;
      items?: unknown;
      conversationAction?: string;
    } | null;
    if (!parsed) return null;
    const transcript =
      (typeof parsed.transcript === 'string' && parsed.transcript.trim()) ||
      (typeof parsed.entities?.transcript === 'string' && parsed.entities.transcript.trim()) ||
      '';
    const raw = input.text.trim() || transcript || message;
    const imageMediaId = hasAudio ? null : input.mediaId;
    return normalizeGeminiResult(parsed, raw, imageMediaId);
  } catch (error) {
    console.warn('[whatsapp] Gemini parser fallback:', error);
    return null;
  }
}

async function parseWithGeminiGuarded(input: WhatsappParseInput): Promise<ParsedWhatsappCommand | null> {
  const hasImage = Boolean(input.image?.buffer?.length);
  const hasAudio = Boolean(input.audio?.buffer?.length);
  const cost = hasImage || hasAudio ? 2 : 1;
  if (input.businessId) {
    try {
      await assertCanUseAi(input.businessId, cost);
    } catch {
      return null;
    }
  }
  const result = await parseWithGemini(input);
  if (result && input.businessId) {
    try {
      await incrementAiUsage(input.businessId, cost);
    } catch (error) {
      console.warn('[whatsapp] No se pudo registrar uso de IA:', error);
    }
  }
  return result;
}

function mergeParsed(
  rules: ParsedWhatsappCommand,
  gemini: ParsedWhatsappCommand | null,
  mediaId?: string | null
): ParsedWhatsappCommand {
  const rawForOrder =
    ('raw' in rules ? rules.raw : '') ||
    (gemini && 'raw' in gemini ? gemini.raw : '') ||
    '';
  const newOrder = looksLikeNewOrder(rawForOrder);

  if (!gemini) {
    if ('entities' in rules) {
      const resolvedMediaId =
        (typeof mediaId === 'string' && mediaId.trim()) ||
        (typeof rules.entities?.mediaId === 'string' && rules.entities.mediaId.trim()) ||
        '';
      const entities: WhatsappCommandEntities = { ...(rules.entities ?? {}) };
      recoverDateMistakenAsClient(entities);
      if (resolvedMediaId) entities.mediaId = resolvedMediaId;
      else delete entities.mediaId;
      const intent =
        newOrder && (rules.intent === 'register_cost' || rules.intent === 'query_status')
          ? 'create_order'
          : rules.intent;
      return { ...rules, intent, entities };
    }
    return rules;
  }

  const operationalRule = [
    'create_order',
    'create_sale',
    'create_purchase',
    'register_payment',
    'create_client',
    'register_cost',
    'update_product_cost',
    'update_order_status',
    'register_cash',
    'query_cash',
    'query_balance',
    'query_stock',
  ].includes(rules.intent);
  /** El modelo manda. Reglas solo si Gemini falló, es unknown, o saludó de más. */
  const speechActRule =
    rules.intent === 'how_to' ||
    rules.intent === 'capability_question' ||
    rules.intent === 'update_order_status';
  const preferGemini =
    gemini.intent === 'unknown'
      ? false
      : speechActRule &&
          (gemini.intent === 'create_order' ||
            gemini.intent === 'create_sale' ||
            gemini.intent === 'help' ||
            gemini.intent === 'greeting')
        ? false
      : operationalRule && (gemini.intent === 'help' || gemini.intent === 'greeting')
        ? false
        : true;

  const base = preferGemini ? gemini : rules;
  if (base.intent === 'help' || base.intent === 'greeting') return base;
  if (base.intent === 'how_to' || base.intent === 'capability_question') {
    const ents = {
      ...('entities' in rules ? rules.entities ?? {} : {}),
      ...('entities' in gemini ? gemini.entities ?? {} : {}),
    };
    ents.productName = undefined;
    ents.spokenProductName = undefined;
    ents.items = undefined;
    return { ...base, entities: ents };
  }

  const ruleEntities = 'entities' in rules ? rules.entities ?? {} : {};
  const geminiEntities = 'entities' in gemini ? gemini.entities ?? {} : {};
  const resolvedMediaId =
    (typeof mediaId === 'string' && mediaId.trim()) ||
    (typeof geminiEntities.mediaId === 'string' && geminiEntities.mediaId.trim()) ||
    (typeof ruleEntities.mediaId === 'string' && ruleEntities.mediaId.trim()) ||
    '';
  const raw = ('raw' in base ? base.raw : '') || ('raw' in rules ? rules.raw : '');
  const entities: WhatsappCommandEntities = preferGemini
    ? adoptGeminiEntities(geminiEntities, ruleEntities, raw)
    : enrichEntitiesFromText(raw, coalesceEntities(ruleEntities, geminiEntities));
  traceOrderItems('after-merge', entities.items);
  if (resolvedMediaId) entities.mediaId = resolvedMediaId;
  else delete entities.mediaId;
  recoverDateMistakenAsClient(entities);
    if (
      (ruleEntities.referToLast || geminiEntities.referToLast) &&
      !entities.orderNumber &&
      !entities.clientName
    ) {
      entities.referToLast = true;
    }
    if (entities.clientName) entities.referToLast = undefined;

  if (newOrder) {
    entities.referToLast = undefined;
    entities.targetOrderId = undefined;
    entities.targetOrderLabel = undefined;
    const requested =
      geminiEntities.requestedStatus ||
      entities.requestedStatus ||
      extractExplicitRequestedStatus(rawForOrder || raw);
    if (requested) {
      entities.requestedStatus = requested;
      entities.orderStatus = requested;
    }
  }

  // «quedó listo», «se lo entregué»: avisa de un pedido que ya existe, nunca es uno nuevo.
  const statusUpdate =
    rules.intent === 'update_order_status' &&
    !newOrder &&
    ['create_order', 'query_status', 'register_payment', 'unknown'].includes(base.intent);

  if (rules.intent === 'update_order_status' && !newOrder && ruleEntities.orderStatus) {
    entities.orderStatus = ruleEntities.orderStatus;
    const utterance = rawForOrder || raw;
    const mentionedPay =
      looksLikeCollectFullBalance(utterance) ||
      PAYMENT_PATTERNS.test(utterance) ||
      PAY_FULL_PATTERNS.test(utterance) ||
      SETTLE_BALANCE_PATTERNS.test(utterance) ||
      Boolean(ruleEntities.payFullBalance || ruleEntities.paid);
    if (looksLikeCollectFullBalance(utterance) && !(Number(entities.amount) > 0)) {
      entities.paid = true;
      entities.payFullBalance = true;
    } else if (!mentionedPay) {
      entities.amount = undefined;
      entities.paid = undefined;
      entities.payFullBalance = undefined;
    }
  }

  const cashRule =
    rules.intent === 'register_cash' &&
    !newOrder &&
    [
      'create_purchase',
      'create_order',
      'register_payment',
      'register_cost',
      'unknown',
      'query_cash',
      'query_balance',
      'query_status',
    ].includes(base.intent);

  const cashQueryRule =
    rules.intent === 'query_cash' &&
    !looksLikeCashMovement(raw) &&
    ['help', 'greeting', 'query_balance', 'query_status', 'unknown'].includes(base.intent);

  const listOrdersRule =
    rules.intent === 'query_status' &&
    Boolean(ruleEntities.listOrders) &&
    ['unknown', 'help', 'greeting', 'query_balance', 'register_cash'].includes(base.intent);

  const orphanPayRule =
    rules.intent === 'register_payment' &&
    !newOrder &&
    ['unknown', 'help', 'query_status', 'register_cash', 'query_cash'].includes(base.intent);

  const existingQuery =
    looksLikeExistingOrderQuery(rawForOrder || raw) &&
    !newOrder &&
    ['create_order', 'create_sale', 'unknown', 'query_balance'].includes(base.intent);

  const intent = (
    existingQuery
      ? 'query_status'
      : statusUpdate
      ? 'update_order_status'
      : cashRule
        ? 'register_cash'
      : cashQueryRule
        ? 'query_cash'
      : listOrdersRule
        ? 'query_status'
      : orphanPayRule
        ? 'register_payment'
      : newOrder && (base.intent === 'register_cost' || base.intent === 'query_status')
        ? 'create_order'
        : base.intent
  ) as Exclude<WhatsappIntent, 'help' | 'greeting'>;

  if (existingQuery) {
    entities.productName = undefined;
    entities.spokenProductName = undefined;
    if (/^(este|esta|esto|ese|esa|eso)\b/i.test(String(entities.clientName ?? '').trim())) {
      entities.clientName = undefined;
      entities.spokenClientName = undefined;
    }
    if (!entities.orderNumber && !entities.targetOrderId) entities.referToLast = true;
  }

  if (statusUpdate) {
    if (ruleEntities.orderStatus) entities.orderStatus = ruleEntities.orderStatus;
    stripProductGuessFromStatus(entities);
    if (ruleEntities.payFullBalance || ruleEntities.paid || looksLikeCollectFullBalance(rawForOrder || raw)) {
      entities.payFullBalance = true;
      entities.paid = true;
    }
  }

  const statusIntent = intent === 'update_order_status' || rules.intent === 'update_order_status';
  if (statusIntent && !newOrder) {
    const utterance = rawForOrder || raw;
    const settle = looksLikeCollectFullBalance(utterance);
    const mentionedPay =
      settle ||
      PAYMENT_PATTERNS.test(utterance) ||
      PAY_FULL_PATTERNS.test(utterance) ||
      SETTLE_BALANCE_PATTERNS.test(utterance) ||
      Boolean(ruleEntities.payFullBalance || ruleEntities.paid);
    if (settle && !(Number(entities.amount) > 0)) {
      entities.payFullBalance = true;
      entities.paid = true;
    } else if (!mentionedPay) {
      entities.amount = undefined;
      entities.paid = undefined;
      entities.payFullBalance = undefined;
    }
  }

  if (cashRule) {
    if (ruleEntities.cashType) entities.cashType = ruleEntities.cashType;
    if (!entities.cashConcept && ruleEntities.cashConcept) {
      entities.cashConcept = ruleEntities.cashConcept;
    }
    entities.cashAmbitoHint =
      entities.cashAmbitoHint || ruleEntities.cashAmbitoHint || raw || undefined;
  }

  if (listOrdersRule || ruleEntities.listOrders) entities.listOrders = true;
  if (orphanPayRule && ruleEntities.payFullBalance) {
    entities.payFullBalance = true;
    entities.paid = true;
  }

  return {
    intent,
    confidence: Math.max(rules.confidence ?? 0, gemini.confidence ?? 0),
    entities,
    raw: 'raw' in base ? base.raw : 'raw' in rules ? rules.raw : '',
    followUpAction: gemini.followUpAction ?? rules.followUpAction,
    choiceIndex: gemini.choiceIndex ?? rules.choiceIndex,
    choiceIndexes: gemini.choiceIndexes ?? rules.choiceIndexes,
    conversationAction: gemini.conversationAction ?? rules.conversationAction,
  };
}

/** Parser con reglas + Gemini (texto, imagen y/o audio). */
export async function parseWhatsappCommand(
  input: string | WhatsappParseInput
): Promise<ParsedWhatsappCommand> {
  const normalized: WhatsappParseInput =
    typeof input === 'string' ? { text: input } : input;

  const text = normalized.text.trim();
  const hasImage = Boolean(normalized.image?.buffer?.length);
  const hasAudio = Boolean(normalized.audio?.buffer?.length);

  if (!text && !hasImage && !hasAudio) {
    return { intent: 'unknown', confidence: 0, raw: '', entities: {} };
  }

  const rules = text
    ? parseWithRules(text, normalized.conversation)
    : ({
        intent: 'unknown',
        confidence: 0.2,
        entities: {},
        raw: '',
      } satisfies ParsedWhatsappCommand);

  const skipGeminiForChitchat =
    isTrivialWhatsappTurn(text) &&
    !hasImage &&
    !hasAudio &&
    !normalized.conversation?.originalIntent &&
    !normalized.conversation?.pendingIntent;
  const rulesKnowsRead =
    !hasImage &&
    !hasAudio &&
    rules.confidence >= 0.85 &&
    (rules.intent === 'query_balance' ||
      rules.intent === 'help' ||
      rules.intent === 'how_to' ||
      rules.intent === 'capability_question' ||
      rules.intent === 'greeting' ||
      (rules.intent === 'query_cash' && !looksLikeCashMovement(text)));

  const needsGemini =
    Boolean(process.env.GEMINI_API_KEY?.trim()) && !skipGeminiForChitchat && !rulesKnowsRead;

  const gemini = needsGemini ? await parseWithGeminiGuarded(normalized) : null;
  const imageMediaId = hasAudio ? null : normalized.mediaId;
  const merged = adoptStockResolutionIfAwaiting(
    pinFocusOrderToParsed(mergeParsed(rules, gemini, imageMediaId), normalized.conversation),
    text,
    normalized.conversation
  );
  if ('entities' in merged) {
    const ents = merged.entities ?? {};
    if (
      (merged.intent === 'query_status' ||
        merged.intent === 'update_order_status' ||
        merged.intent === 'register_payment') &&
      !ents.orderNumber &&
      !ents.targetOrderId &&
      !normalized.conversation?.focusOrder?.id
    ) {
      const fromTurns = [...(normalized.conversation?.turns ?? [])]
        .reverse()
        .map((turn) => extractOrderNumberFromText(String(turn.text ?? '')))
        .find(Boolean);
      if (fromTurns) {
        merged.entities = { ...ents, orderNumber: fromTurns, referToLast: false };
      }
    }
  }
  const focus = normalized.conversation?.focusOrder;
  if (
    merged.intent === 'unknown' &&
    (focus?.id || normalized.conversation?.lastOperation?.id) &&
    (looksLikeStatusQuery(text) || looksLikeExistingOrderQuery(text))
  ) {
    return pinFocusOrderToParsed(
      {
        intent: 'query_status',
        confidence: 0.85,
        entities: {
          ...('entities' in merged ? merged.entities ?? {} : {}),
          referToLast: !focus?.id,
          sourceText: text,
        },
        raw: text,
      },
      normalized.conversation
    );
  }
  if ('entities' in merged && merged.entities) {
    if (!PRODUCT_INTENTS.has(merged.intent)) {
      merged.entities.productName = undefined;
      merged.entities.spokenProductName = undefined;
      if (merged.intent !== 'query_stock') merged.entities.items = undefined;
    } else if (merged.intent === 'create_order' || merged.intent === 'create_sale') {
      if (isPlaceholderProductLabel(merged.entities.productName)) {
        merged.entities.productName = undefined;
        merged.entities.spokenProductName = undefined;
      }
      ensureOrderItems(merged.entities);
      syncLegacyProductFields(merged.entities);
      if (
        merged.entities.items?.length &&
        merged.entities.items.every((item) =>
          isPlaceholderProductLabel(item.rawText || item.productHint || item.productName)
        )
      ) {
        merged.entities.items = undefined;
        merged.entities.productName = undefined;
      }
    }
  }
  return merged;
}
