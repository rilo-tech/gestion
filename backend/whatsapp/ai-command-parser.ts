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
  looksLikeStatusQuery,
  extractExtraCostsFromText,
  mergeExtraCostItems,
  sanitizeOrderNotes,
  parseInvoiceMoney,
  grossUpPurchaseLinesIfVatSeparated,
  inferPurchasePackUnits,
  extractCatalogCostUpdate,
  type ExtraCostItem,
} from './lookups.ts';
import { parsePersonNameAndPhone } from './client-identity.ts';
import { formatOperatorMemoryPrompt, loadOperatorMemory } from './operator-memory.ts';
import { assertCanUseAi, incrementAiUsage } from '../auth/usage-gates.ts';
import { whatsappCopyForRubro } from './copy.ts';
import { isTrivialWhatsappTurn } from './operator-voice.ts';
import { generateGeminiJson } from './gemini.ts';

export type WhatsappIntent =
  | 'help'
  | 'greeting'
  | 'create_order'
  | 'create_sale'
  | 'create_purchase'
  | 'register_payment'
  | 'query_balance'
  | 'query_cash'
  | 'query_status'
  | 'register_cash'
  | 'create_client'
  | 'register_cost'
  | 'update_product_cost'
  | 'update_order_status'
  | 'unknown';

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
  /** Seña (primer pago de un pedido) o cobro suelto. */
  paymentKind?: 'senia' | 'pago';
  /** Seña que dejó junto con el pedido, para cobrarla al guardarlo. */
  seniaAmount?: number;
  /** Listar pedidos abiertos (el dueño no recuerda cuál). */
  listOrders?: boolean;
  /** Cobrar todo el saldo pendiente («ya pagó», «pagó el resto», «saldalo»). */
  payFullBalance?: boolean;
  /** Nuevo estado del pedido cuando el dueño avisa que avanzó. */
  orderStatus?: 'pendiente' | 'en_produccion' | 'listo' | 'entregado';
  /** Datos del pedido apuntado, para mostrarlos antes de confirmar. */
  targetOrderSaldo?: number;
  targetOrderEstadoLabel?: string;
  orderStatusLabel?: string;
  orderStockWillDrop?: boolean;
  orderStockAlreadyDropped?: boolean;
  orderHasStockLines?: boolean;
  orderStatusUnchanged?: boolean;
  /** Costos extra del pedido (estampado, vinilo) para el cálculo de ganancia. */
  extraCosts?: ExtraCostItem[];
  targetOrderId?: string;
  targetOrderLabel?: string;
  /** Número de pedido que nombró el dueño («#00223», «el 223»). */
  orderNumber?: string;
  /** Consulta sobre lo último que se guardó. */
  referToLast?: boolean;
  saveAsDraft?: boolean;
  paymentIncompleteReason?: string;
};

export type WhatsappFollowUpAction = 'continue' | 'choose' | 'confirm' | 'cancel' | 'new' | 'ask';

export type ParsedWhatsappCommand =
  | { intent: 'help'; confidence: number; raw?: string; followUpAction?: WhatsappFollowUpAction; choiceIndex?: number }
  | { intent: 'greeting'; confidence: number; followUpAction?: WhatsappFollowUpAction; choiceIndex?: number }
  | {
      intent: Exclude<WhatsappIntent, 'help' | 'greeting'>;
      confidence: number;
      entities?: WhatsappCommandEntities;
      raw: string;
      followUpAction?: WhatsappFollowUpAction;
      choiceIndex?: number;
    };

export type WhatsappParseConversation = {
  originalIntent?: string;
  pendingIntent?: string;
  awaiting?: string;
  knownEntities?: WhatsappCommandEntities;
  missingKeys?: string[];
  candidates?: Array<{ index: number; label: string }>;
  lastOperation?: { kind?: string; id?: string; label?: string; clientName?: string } | null;
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
];
const ORDER_PATTERNS = /\b(pedido|orden)\b/i;
const SALE_PATTERNS = /\b(venta|vend[ií])\b/i;
const PURCHASE_PATTERNS =
  /\b(compra|compr[eé]|remito|factura\s+(de\s+)?compra|proveedor|lleg[oó]\s+(la\s+)?mercader[ií]a)\b/i;
const PAYMENT_PATTERNS =
  /\b(pago|pagu[eé]|pag[oó]|cobro|cobr[eé]|cobr[oó]|abon[oóaáeé]|se[ñn]a|se[ñn][oó]|adelanto|anticipo|a\s+cuenta)\b/i;
/** Seña / adelanto: el primer pago va contra un pedido puntual. */
const SENIA_PATTERNS = /\b(se[ñn]a|se[ñn][oó]|adelanto|anticipo|a\s+cuenta)\b/i;
/** El mensaje arranca hablando de un cobro: «cobré…», «me pagó…», «abonó…». */
const PAYMENT_LEAD_PATTERNS = /^\s*(ya\s+)?(me\s+|te\s+|le\s+)?(cobr|pag|abon)/i;
// Los límites van con \p{L} porque \b no corta bien contra vocales acentuadas («entregué»).
/** Pagó todo lo que debía, sin decir el monto. */
const PAY_FULL_PATTERNS =
  /(?<![\p{L}])(pag[oó]\s+(todo|el\s+resto|lo\s+que\s+faltaba|completo)|(ya|me)\s+pag[oó](?![\p{L}])(?!\s*\$?\s*\d)|abon[oó]\s+(todo|el\s+resto)|qued[oó]\s+saldado|sald(?:alo|ar)(?!\s+de)|saldo\s+cero|est[aá]\s+(todo\s+)?pago)/iu;
const SETTLE_BALANCE_PATTERNS =
  /(?<![\p{L}])(sald(?:alo|ar)(?!\s+de)|pago\s+del\s+total(?:\s+del\s+saldo)?|total\s+del\s+saldo|cobra(?:r)?\s+(?:el\s+)?(?:saldo|total)|registr[aeá]\s+(?:el\s+)?pago(?:\s+del\s+(?:total|saldo))?)/iu;
/** El dueño avisa que el pedido avanzó de estado. */
const ORDER_STATUS_PATTERNS =
  /(?<![\p{L}])(qued[oó]\s+(listo|pronto|terminad[oa])|ya\s+est[aá]\s+(listo|pronto|terminad[oa]|pronta)|est[aá]\s+listo|(lo\s+)?termin[eé]|termin[eé]\s+(el\s+|ese\s+)?pedido|marc(?:[aá]|alo|amelo)|pas(?:[aá]|alo|amelo)\s+(?:el\s+|ese\s+|este\s+)?(?:pedido\s+)?a\s+\w+|pon(?:[eé]lo|elo|[eé])\s+(en|como)\s+\w+|entregu[eé]|entregad[oa]|se\s+lo\s+(di|entregu[eé]|llev[oó])|ya\s+lo\s+(retir[oó]|llev[oó]|busc[oó])|lo\s+(retir[oó]|llev[oó])|en\s+producci[oó]n|empec[eé]\s+(a\s+hacer|el\s+pedido)|lo\s+estoy\s+haciendo)(?![\p{L}])/iu;
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

/** «¿cómo quedó el pedido?» pregunta; «el pedido quedó listo» avisa. */
function looksLikeQuestion(text: string): boolean {
  if (/[¿?]/.test(text)) return true;
  return /\b(qu[eé]|c[oó]mo|cu[aá]l|cu[aá]les|d[oó]nde|cu[aá]nto|cu[aá]ndo)\b/i.test(text);
}

function orderStatusFromText(text: string): 'pendiente' | 'en_produccion' | 'listo' | 'entregado' {
  const named = text.match(
    /\b(?:pas(?:[aá]|alo|amelo)|pon(?:[eé]lo|elo|[eé])|marc(?:[aá]|alo|amelo)|dej(?:[aá]|alo)|ponelo)\s+(?:el\s+|ese\s+|este\s+)?(?:pedido\s+)?(?:a|en|como)\s+(?:estado\s+)?(entregad[oa]|listo|pronto|terminad[oa]|pendiente|producci[oó]n)\b/i
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
  return ORDER_STATUS_PATTERNS.test(t);
}
/** «registrá un pedido», «nueva venta»: crear, no cobrar. */
const ORDER_CREATE_PATTERNS =
  /\b(ingres\w+|registr\w+|anot\w+|carg\w+|arm\w+|nuev[oa])\s+(un[ao]?\s+|el\s+|la\s+)?(pedido|orden|venta)\b/i;
const COST_ITEM_PATTERNS =
  /\b((agreg[áa]|sum[áa]|anot[áa]|registr[áa]|cargar|poner|poneme|sumale|sumále|agregale|agregále|pon[eé]le)\s+(un\s+)?(?:(?:í|i)tem\s+de\s+)?(?:al\s+)?costos?|(agreg[áa]|sum[áa]|sumale|sumále|agregale|agregále)\s+\$?\s*[\d.]+\s+(?:al\s+)?costos?|al\s+costos?|costos?\s+extra|(?:í|i)tem\s+de\s+costo|costos?\s+(?:extra\s+)?(?:de\s+|del\s+|al\s+)?(?!pedido\b|orden\b|venta\b|de\b|del\b|al\b)[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}|[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{1,40}?\s+\$?\s*[\d.]+\s*(?:de\s+)?costos?|\bcostos?\s*\$?\s*\d)/i;
const CLIENT_REGISTER_PATTERNS =
  /\b((registr(?:ar|[áa])|nuevo|alta|cargar|anotar|agregar|crear)\s+(el\s+|un\s+|los\s+)?clientes?|clientes?\s+nuevos?)\b/i;
const BALANCE_PATTERNS =
  /\b((saldo|debe|cuenta)\s+(de|del)\s+(?!las\s+cajas?\b)(?!la\s+caja\b)(?!cajas?\b)|cu[aá]nto\s+debe)\b/i;
const CASH_QUERY_PATTERNS =
  /\b(caja\s+(de\s+)?hoy|cu[aá]nto\s+vend[ií]|resumen\s+(de\s+)?caja|movimientos?\s+(de\s+)?caja|cu[aá]nto\s+(hay\s+)?en\s+caja|saldo\s+neto|cu[aá]nto\s+saldo|saldo\s+(de\s+)?(la[s]?\s+)?cajas?|de\s+la[s]?\s+cajas?|cu[aá]nto\s+tengo|cu[aá]nto\s+queda\s+en\s+(la\s+)?caja|qu[eé]\s+saldo\s+(tengo|hay))\b/i;
const CASH_OUT_PATTERNS =
  /(?<![\p{L}])(?:gasto|egreso|salida(?:\s+de\s+caja)?|(?:retir[eéoó]|sac[aáe](?:lo)?)\s+(?:plata\s+)?(?:de\s+)?(?:la\s+)?caja|(?:hace|hac[eé]|hacele|anot[aá]|registr[aá]|pon[eé]|cargar)\s+(?:un[ao]?\s+)?(?:egreso|gasto|salida))(?![\p{L}])/iu;
const CASH_IN_PATTERNS =
  /(?<![\p{L}])(?:ingreso\s+de\s+caja|entrada\s+de\s+caja|ingres[oaá]\s+(?:a|en)\s+(?:la\s+)?caja|entrada\s+(?:a|en)\s+(?:la\s+)?caja|(?:hace|hac[eé]|hacele|anot[aá]|registr[aá]|pon[eé]|cargar)\s+(?:un[ao]?\s+)?ingreso(?:\s+de\s+caja)?|(?:un\s+)?ingreso\s+(?:de\s+|por\s+)?\$?\s*[\d.]|(?:una\s+)?entrada\s+(?:de\s+|por\s+)?\$?\s*[\d.]|met[eé](?:r)?\s+plata(?:\s+en\s+(?:la\s+)?caja)?)(?![\p{L}])/iu;
const QUERY_STATUS_PATTERNS =
  /\b(en\s+qu[eé]\s+estado|qu[eé]\s+estado|c[oó]mo\s+qued[oó]|c[oó]mo\s+lo\s+(registraste|anotaste|dejaste|pusiste|cargaste)|c[oó]mo\s+est[aá]\s+(el|la|ese|esa|esto|eso)|busc(?:[aá]|ar)\s+(el\s+|un\s+)?(pedido|venta|compra)|resumen\s+(del|de\s+(el|la|ese|esa|esto|eso)|pedido)|el\s+[uú]ltimo\s+(pedido|venta)|pedido\s*#\s*\d+|qu[eé]\s+(le\s+)?(pusiste|anotaste|registraste|pidi[oó]|compr[oó])|d[oó]nde\s+lo\s+(dejaste|pusiste|anotaste)|n(?:ro\.?|[uú]m(?:ero)?)(?:\s+de)?\s+pedido|qu[eé]\s+n(?:ro\.?|[uú]mero)|tiene\s+(el\s+)?pedido|cu[aá]l\s+es\s+el\s+pedido|el\s+pedido\s+de|qu[eé]\s+pidi[oó]|qu[eé]\s+compr[oó]|qu[eé]\s+le\s+(anotamos|cargamos|pusimos))/i;
const LIST_ORDERS_PATTERNS =
  /\b((list(?:ame|[áa])?|mostr(?:ame|[áa])|busc(?:ame|[áa]))\s+(los\s+|el\s+|la\s+|un\s+|de\s+)?(pedidos?)?|qu[eé]\s+pedidos?(?:\s+hay)?|pedidos?\s+(con\s+saldo|abiertos?|pendientes?|sin\s+pagar)|no\s+s[eé]\s+(de\s+)?qu[eé]\s+pedido)\b/i;
const ORPHAN_PAYMENT_PATTERNS =
  /\b(me\s+lleg[oó]\s+(un\s+)?pago|me\s+pagaron|lleg[oó]\s+(una\s+)?transferencia|un\s+pago\s+de)\b/i;

const ALLOWED_INTENTS: WhatsappIntent[] = [
  'help',
  'greeting',
  'create_order',
  'create_sale',
  'create_purchase',
  'register_payment',
  'query_balance',
  'query_cash',
  'query_status',
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
    'orderNumber',
    'targetOrderId',
    'targetOrderLabel',
    'listOrders',
    'cashType',
    'cashConcept',
    'cashAmbitoHint',
    'cashAmbitoId',
    'cashAmbitoLabel',
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
    'sourceText',
    'extraCosts',
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
    if (incomingClient.toLowerCase() !== current.toLowerCase()) {
      next.spokenClientName = incoming.spokenClientName || incomingClient;
      next.clientName = incomingClient;
      next.clientId = undefined;
    }
  }

  if (incoming.clientPhone) next.clientPhone = incoming.clientPhone;
  if (incoming.productName) {
    const productName = cleanedProductName(incoming.productName);
    next.spokenProductName = next.spokenProductName || incoming.spokenProductName || productName;
    if (productName.toLowerCase() !== String(known.productName ?? '').trim().toLowerCase()) {
      next.productId = incoming.productId || undefined;
    }
    next.productName = productName;
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
  if (incoming.paymentHint) next.paymentHint = incoming.paymentHint;
  if (incoming.paymentKind) next.paymentKind = incoming.paymentKind;
  if (incoming.seniaAmount) next.seniaAmount = incoming.seniaAmount;
  if (incoming.orderStatus) next.orderStatus = incoming.orderStatus;
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
    const allowReplace =
      !clientOnly &&
      (Boolean(spoken.productName) ||
        /\b(producto|talle|camiseta|remera|buzo|jean|pantal|taza|campera)\b/i.test(text));
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

  recoverDateMistakenAsClient(next);
  return next;
}

export function sanitizeWhatsappEntities(entities: WhatsappCommandEntities): void {
  recoverDateMistakenAsClient(entities);
  if (entities.deliveryDate) entities.deliveryAsked = true;
}

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
  if (!next.productName) {
    const product = extractProductHintFromText(text);
    if (product) {
      next.productName = product;
      if (!next.spokenProductName) next.spokenProductName = product;
    }
  }
  next.extraCosts = next.extraCosts?.length
    ? next.extraCosts
    : mergeExtraCostItems(undefined, extractExtraCostsFromText(text));
  if (!next.extraCosts.length) delete next.extraCosts;
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

function parseWithRules(
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
  if (looksLikeHelpRequest(text)) {
    return { intent: 'help', confidence: 0.92, raw: text };
  }

  const entities = enrichEntitiesFromText(text);
  if (/^(el\s+)?saldos?[\s?¿!.]*$/i.test(text)) {
    return { intent: 'query_cash', confidence: 0.92, entities, raw: text };
  }
  const inProgressOrder =
    conversation?.originalIntent === 'create_order' ||
    conversation?.originalIntent === 'create_sale' ||
    conversation?.awaiting === 'deliveryDate' ||
    conversation?.awaiting === 'notes' ||
    conversation?.awaiting === 'fields';
  const isNewOrder = looksLikeNewOrder(text) || /\b(pedido|orden)\s+(para|a|nuevo|nueva)\b/i.test(text);
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
  const settleLike = SETTLE_BALANCE_PATTERNS.test(text);
  const paidMentioned = PAY_FULL_PATTERNS.test(text) && !settleLike;
  if (
    ORDER_STATUS_PATTERNS.test(text) &&
    !isNewOrder &&
    !ORDER_CREATE_PATTERNS.test(text) &&
    !PURCHASE_PATTERNS.test(text) &&
    !looksLikeQuestion(text)
  ) {
    const orderNumber = extractOrderNumberFromText(text) || entities.orderNumber;
    const clientName = entities.clientName || extractQueryClientFromText(text) || undefined;
    const fromText = orderStatusFromText(text);
    return {
      intent: 'update_order_status',
      confidence: 0.9,
      entities: {
        ...entities,
        // «ya pagó» cierra en entregado. «listo y saldalo» deja listo y cobra el saldo.
        orderStatus: paidMentioned ? 'entregado' : fromText,
        ...(paidMentioned || settleLike ? { paid: true, payFullBalance: true } : {}),
        ...(orderNumber ? { orderNumber } : {}),
        ...(clientName ? { clientName, spokenClientName: entities.spokenClientName || clientName } : {}),
        referToLast: !orderNumber && !clientName,
      },
      raw: text,
    };
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
      (Boolean(conversation?.lastOperation?.id) &&
        /\b(estado|resumen|lo|eso|ese|esa|el [uú]ltimo|pidi[oó]|compr[oó]|n[uú]mero)/i.test(text) &&
        !/\b(pedido|orden)\s+(para|a|de)\b/i.test(text) &&
        !PAYMENT_PATTERNS.test(text) &&
        !SALE_PATTERNS.test(text) &&
        !PURCHASE_PATTERNS.test(text)));
  if (statusQuery) {
    const orderNumber = extractOrderNumberFromText(text) || entities.orderNumber;
    const clientName = extractQueryClientFromText(text) || entities.clientName || undefined;
    return {
      intent: 'query_status',
      confidence: 0.93,
      entities: {
        ...entities,
        ...(orderNumber ? { orderNumber } : {}),
        ...(clientName ? { clientName, spokenClientName: entities.spokenClientName || clientName } : {}),
        referToLast: !orderNumber && !clientName,
      },
      raw: text,
    };
  }
  if (CLIENT_REGISTER_PATTERNS.test(text)) {
    return { intent: 'create_client', confidence: 0.9, entities, raw: text };
  }
  if (CASH_QUERY_PATTERNS.test(text) && !PAYMENT_LEAD_PATTERNS.test(text)) {
    return { intent: 'query_cash', confidence: 0.9, entities, raw: text };
  }
  if (
    (CASH_OUT_PATTERNS.test(text) || CASH_IN_PATTERNS.test(text)) &&
    !ORDER_CREATE_PATTERNS.test(text) &&
    !ORDER_PATTERNS.test(text) &&
    !SALE_PATTERNS.test(text)
  ) {
    const cashType: 'ingreso' | 'egreso' = CASH_OUT_PATTERNS.test(text) ? 'egreso' : 'ingreso';
    const concept =
      text
        .replace(CASH_OUT_PATTERNS, ' ')
        .replace(CASH_IN_PATTERNS, ' ')
        .replace(/\$?\s*[\d.,]+/g, ' ')
        .replace(/\bdescripci[oó]n\b[:\s]*/gi, ' ')
        .replace(/\b(registr[aeoá]|anot[aeoá]|hac[eé]|cargar|una?|de|la|el|caja|por)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim() || (cashType === 'egreso' ? 'Egreso' : 'Ingreso');
    return {
      intent: 'register_cash',
      confidence: 0.86,
      entities: { ...entities, cashType, cashConcept: concept, cashAmbitoHint: text },
      raw: text,
    };
  }
  if (PURCHASE_PATTERNS.test(text)) {
    return { intent: 'create_purchase', confidence: 0.8, entities, raw: text };
  }
  if (ORDER_PATTERNS.test(text)) {
    return { intent: 'create_order', confidence: 0.75, entities, raw: text };
  }
  if (SALE_PATTERNS.test(text)) {
    return { intent: 'create_sale', confidence: 0.75, entities, raw: text };
  }
  if (PAYMENT_PATTERNS.test(text)) {
    return { intent: 'register_payment', confidence: 0.7, entities, raw: text };
  }
  if (CASH_QUERY_PATTERNS.test(text)) {
    return { intent: 'query_cash', confidence: 0.9, entities, raw: text };
  }
  if (BALANCE_PATTERNS.test(text)) {
    return { intent: 'query_balance', confidence: 0.7, entities, raw: text };
  }

  return { intent: 'unknown', confidence: 0.2, entities, raw: text };
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
  },
  raw: string,
  mediaId?: string | null
): ParsedWhatsappCommand {
  const followUpAction = parseFollowUpAction(parsed.followUpAction);
  const choiceIndexRaw = Number(parsed.choiceIndex);
  const choiceIndex =
    Number.isInteger(choiceIndexRaw) && choiceIndexRaw >= 1 && choiceIndexRaw <= 20
      ? choiceIndexRaw
      : undefined;
  const extras = { ...(followUpAction ? { followUpAction } : {}), ...(choiceIndex ? { choiceIndex } : {}) };

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
    purchaseLines: parsePurchaseLines(rawEntities.purchaseLines ?? rawEntities.items),
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
  });
  if (entities.purchaseLines?.length) {
    entities.purchaseLines = grossUpPurchaseLinesIfVatSeparated(
      entities.purchaseLines,
      entities.amount
    );
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
    const productRule = copy.hasProductExamples
      ? `- productName: extraé el ítem aunque esté en el medio de la frase. Conservá el detalle (talle, color, material). Ejemplo: «${copy.exampleProduct}». No inventes. No pongas la fecha ni el cliente dentro de productName.`
      : '- productName: extraé el ítem aunque esté en el medio de la frase. Conservá el detalle que dijo. No inventes un rubro. No pongas la fecha ni el cliente dentro de productName.';
    const conversation = input.conversation;
    const lastOp = conversation?.lastOperation;
    const inProgress = Boolean(
      conversation?.pendingIntent || conversation?.awaiting || conversation?.originalIntent
    );
    const lastOpLine = lastOp?.id
      ? `- Último guardado: ${[lastOp.kind, lastOp.label ? '#' + lastOp.label : '', lastOp.clientName]
          .filter(Boolean)
          .join(' ')}. Si pregunta estado, qué pidió, qué compró, número de pedido, «lo/eso» o «el último», intent=query_status. referToLast=true solo si no nombra cliente ni número.`
      : '';
    const conversationBlock = inProgress
      ? `
HAY UNA OPERACIÓN EN CURSO. El usuario está completando o CORRIGIENDO, no empezando de cero (salvo que el mensaje sea claramente otra operación: un cobro, una venta distinta, un gasto).
- Operación: ${conversation?.originalIntent || conversation?.pendingIntent || 'desconocida'}
- Esperábamos: ${conversation?.awaiting || 'más datos'}
- Datos ya cargados (NO los pises salvo corrección explícita): ${JSON.stringify(compactKnownEntities(conversation?.knownEntities))}
- Campos que faltaban: ${(conversation?.missingKeys ?? []).join(', ') || 'ninguno'}
${conversation?.candidates?.length ? `- Opciones numeradas: ${conversation.candidates.map((c) => `${c.index}) ${c.label}`).join(' · ')}` : ''}
${lastOpLine}
- followUpAction: continue (actualizar y seguir) | choose (eligió un número o un candidato) | confirm (sí, guardar) | cancel | new (cambió de tema a OTRA operación) | ask (pregunta sobre las opciones o el proceso, SIN elegir todavía)
- choiceIndex: si choose, el número 1-based
- En entities devolvé SOLO campos nuevos o corregidos
- Si pregunta (¿están registrados?, ¿hay uno que se llame X?, ¿cuál es el 1?, ¿qué significa registrar nuevo?): followUpAction=ask. NO uses choose aunque nombre un candidato. NO sigas al siguiente paso.
- choose SOLO si eligió de forma explícita: un número solo, «el 1», «Danyelyn» como respuesta corta SIN pregunta, «ese», «el primero».
- Si la operación en curso es create_order/create_sale y menciona costo extra, extraCosts va EN ESE pedido (followUpAction=continue). NO uses register_cost.
- Si esperábamos confirmación: confirm SOLO si dijo sí/ok/dale/confirmo y no cambió ningún dato. Si corrige cliente, producto, precio, fecha o descripción → continue (nunca cancel). Si pregunta sobre el resumen → ask.
- Si esperábamos elegir producto de una compra o una lista de ítems no reconocidos de una boleta: «saltar / omitir» y «insumo / herramienta / sin stock» son continue (siguen en la misma compra; pueden aplicar a todos los que quedan). Un número = choose. cancel SOLO si cancela TODA la compra.
- «el cliente es X», «el producto es Y», «el precio es 600», «entrega el jueves», «talle M», «la descripción es …» son correcciones (continue)
- Si esperábamos deliveryDate: «mañana», typos (mañan, manana), hoy, un día o 28/08 ES la fecha. NUNCA lo pongas en productName ni clientName.
`
      : lastOpLine
        ? `${lastOpLine}\n- followUpAction y choiceIndex: omitilos si es un mensaje nuevo.`
        : `- followUpAction y choiceIndex: omitilos si es un mensaje nuevo.`;
    const prompt = `Sos el parser de RILO Bot, un ERP por WhatsApp para negocios pequeños (Uruguay/Latam).
Interpretá el mensaje como lo haría una persona: coloquial, en CUALQUIER orden, con typos y correcciones. El usuario no sigue un formato: puede empezar por el producto, el precio, el cliente o un verbo (ingresa, registrá, anotá, cargá). Extraé cada dato donde esté; no te enganches con una sola palabra.
Si hay imagen, usala como referencia (pedido, venta o compra a proveedor).
Si hay audio, transcribilo al español (rioplatense) y clasificá lo que dijo. No inventes palabras que no se oigan.
Devolvé SOLO JSON válido con:
- intent: help|greeting|create_order|create_sale|create_purchase|register_payment|query_balance|query_cash|query_status|register_cash|create_client|register_cost|update_product_cost|update_order_status|unknown
- confidence: 0-1
- transcript: si hay audio, la transcripción literal. Si no se entiende, string vacío.
- followUpAction, choiceIndex (opcionales, ver abajo)
- entities: objeto opcional con clientName, clientPhone, supplierName, productName, quantity, amount (número), notes, paid (boolean), imageSummary, cashType (ingreso|egreso), cashConcept, cashAmbitoHint (nombre de caja: personal, negocio, la mía), orderDate (YYYY-MM-DD), deliveryDate (YYYY-MM-DD), invoiceNumber, purchaseLines (array de { productName, quantity, unitCost, unitCostNet, packUnits }), paymentMethod (efectivo|transferencia|debito|mercado_pago|tarjeta|proveedor si se ve o lo dijo), paymentCuotas (número), paymentKind (seña|pago), seniaAmount (número), orderStatus (pendiente|en_produccion|listo|entregado), payFullBalance (boolean), listOrders (boolean), orderNumber, referToLast (boolean), extraCosts (array de { nombre, costo })

Reglas:
- greeting: solo un saludo corto (hola, buenas), sin pedido de ayuda.
- help: SOLO si pregunta cómo funciona, qué puede hacer, o escribe «consultame» / «ayuda» / «qué productos hay» / «cómo hago un pedido». Si pide registrar un pedido, venta o compra, NO es help aunque diga la palabra «producto».
${productRule}
- clientName: nombre de persona (nombre y apellido si lo dijo). NUNCA un verbo (ingresa, registra, carga), un día de la semana, «hoy», «mañana», un color o un talle. «para el jueves/viernes/...» NO es un cliente.
- create_client: solo dar de alta un cliente, sin pedido/venta/cobro. Ej: «registrar cliente María Pérez», «nuevo cliente Juan», «cargar cliente». Si dice teléfono, clientPhone. Si solo dice «registrar cliente» sin nombre, igual create_client.
- Ejemplo: «ingresa el pedido de danyelyn camiseta xl roja de algodon $620 costo $100 descripcion estampado a3 adelante» → create_order, clientName="danyelyn", productName="camiseta xl roja de algodon", amount=620, extraCosts=[{nombre:"Costo extra", costo:100}], notes="estampado a3 adelante". NUNCA uses register_cost. NUNCA pongas el verbo (ingresa, registra, carga) como clientName.
- create_order: si solo dice «pedido» sin datos, igual intent create_order con entities vacías. Extraé TODO lo que esté en la frase, sin exigir un orden fijo.
- Ejemplo: «Pedido para Lizzy Berneda, camiseta algodón talle S, $550. Descripción diseño adelante KATSEYE» → clientName="Lizzy Berneda", productName="camiseta algodón talle S", amount=550, notes="diseño adelante KATSEYE". No dejes productName ni notes vacíos si están en el mensaje.
- Ejemplo: «Registra un pedido a Leticia Martinez, producto estampado a $250. Costo $100. sin descripcion» → create_order, clientName="Leticia Martinez", productName="estampado", amount=250, extraCosts=[{nombre:"Costo extra", costo:100}], notesAsked (sin descripción). amount es el precio de venta ($250), no el costo.
- Si dice «Producto es camiseta algodón rosa talle S para el miércoles que viene»: productName="camiseta algodón rosa talle S" (sin «Producto es» ni la fecha), deliveryDate=el miércoles.
- Campos ausentes: OMITILOS. No pongas null ni string vacío: eso borra datos ya cargados.
- deliveryDate: opcional. «entrega el viernes», «para el jueves», «el jueves», «20/08», «20 de agosto». Si no la dijo, OMITILA: no inventes hoy ni otra fecha. Si dice «jueves es la fecha de entrega», es una CORRECCIÓN de fecha, no un cliente nuevo.
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
- notes: es la DESCRIPCIÓN del pedido (ubicación del estampado, frase, observaciones). NUNCA copies el mensaje entero. NUNCA pongas «fecha de entrega…», «registrá el costo extra», precios ni nombres de cliente/producto. Si no hay descripción real, omití notes.
- No inventes clientes, proveedores ni montos si no aparecen.
- query_cash: cuánto hay en caja AHORA (saldo neto de cada caja) o el resumen de HOY si lo pidió. Ej: «¿cuánto tengo como saldo neto?», «saldo neto de las cajas», «cuánto hay en caja», «caja de hoy», «cuánto vendí». NO es saldo de un cliente (eso es query_balance) ni un ingreso/egreso (register_cash).
- query_balance: saldo que DEBE un cliente. Hace falta el nombre: «saldo de Pedro», «cuánto debe María». Si habla de cajas / saldo neto sin cliente, es query_cash.
- query_status: consultar un pedido/venta ya guardado. NO es create_order ni create_purchase. Ejemplos: «¿en qué estado lo registraste?», «qué pidió Lizzy», «mostrame el pedido de Cardozo», «el pedido de Lizzy», «pedido #00223», «el último». clientName si nombra a alguien. orderNumber si hay número. referToLast=true solo si habla de lo último / lo / eso SIN nombre. Si pide LISTAR o BUSCAR («listame pedidos», «mostrame el pedido de Cardozo», «buscá el oversize de Sergio»), listOrders=true, clientName/productName si los nombra, referToLast=false. NUNCA uses el último pedido de otro cliente. Si no hay match, no inventes: el sistema pide producto, monto o estado.
- register_payment: el cliente entregó plata por algo YA guardado (seña, adelanto, anticipo, a cuenta, cuota, saldo, «me pagó», «cobré»). clientName, amount = lo que entregó, paymentKind="seña" si es seña/adelanto/anticipo/a cuenta o el primer pago, si no "pago". paymentMethod si dijo cómo (transferencia, efectivo, mercado pago). orderNumber si nombró el pedido; referToLast=true si dice «ese pedido», «el último», «lo que acabo de cargar». Si no nombra cliente ni número («me llegó un pago», «me pagaron 500», «llegó una transferencia»), igual register_payment: amount si hay monto, sin clientName. El sistema pregunta si es cobro de pedido o ingreso suelto. NO es register_cash salvo que diga egreso/gasto/salida de caja o ingreso de caja. NO es create_order.
- Ejemplos de register_payment: «Danyelyn me dejó $200 de seña» → clientName="Danyelyn", amount=200, paymentKind="seña". «seña de 300 del pedido 223 por transferencia» → amount=300, paymentKind="seña", orderNumber="223", paymentMethod=transferencia. «cobré 500 a Lizzy» → amount=500, paymentKind="pago". «me abonó el resto» sin monto → register_payment igual, sin amount (se lo pregunto). «me llegó un pago de 500» → amount=500, sin clientName. «saldalo» → payFullBalance=true.
- OJO: si en el mismo mensaje ARMA un pedido nuevo y además dice que dejó seña («pedido para Ana, buzo $1500, señó $500»), es create_order con amount=1500 y seniaAmount=500. La seña se cobra al guardar el pedido. Solo es register_payment si el pedido ya existía.
- seniaAmount: plata que dejó junto con el pedido («señó 500», «dejó $200 de seña», «con un adelanto de 300»). NUNCA la pongas en amount (amount es el precio de venta) ni en extraCosts.
- update_order_status: el dueño AVISA que un pedido ya guardado avanzó. «quedó listo», «lo terminé», «ya está pronto» → orderStatus="listo". «lo estoy haciendo», «empecé» → "en_produccion". «se lo entregué», «lo retiró», «ya lo llevó», «pasalo a entregado», «pasalo a estado entregado» → "entregado". orderNumber si lo nombra, clientName si nombra al cliente, referToLast=true si dice «ese» / «el último». NO es query_status (eso es PREGUNTAR cómo está).
- «pasalo a estado entregado» / «ponelo como entregado» es entregado aunque el pedido ya esté Listo. NO lo dejes en listo. NO copies un monto de un mensaje anterior. NO cobres el saldo salvo que diga que pagó / saldalo / ya pagó.
- Si además avisa que le pagó todo («y ya pagó», «me pagó todo», «quedó saldado») → orderStatus="entregado", paid=true, payFullBalance=true. Cerrar el pedido cobra el saldo que faltaba.
- Ejemplo: «el pedido quedó listo y danyelyn ya pagó» → update_order_status, clientName="danyelyn", orderStatus="entregado", paid=true, payFullBalance=true.
- Ejemplo: «El pedido de Sergio pasalo a estado entregado» → update_order_status, clientName="Sergio", orderStatus="entregado". Sin amount, sin paid.
- Ejemplo: «pasa el pedido a listo y registra el pago del total del saldo» → update_order_status, orderStatus="listo", paid=true, payFullBalance=true. NO es entregado: cobra el saldo y deja el estado en listo.
- payFullBalance: true si dijo que pagó TODO, el resto, el total del saldo, «saldalo» o «registrá el pago del total», sin un monto puntual.
- register_cash: gasto/egreso o ingreso MANUAL de caja, en un mensaje aparte de la compra. Coloquial: «hacé un egreso de caja por 4015 en personal», «egreso 500 en personal», «sacá 200 de caja del negocio», «ingreso 2000 a caja del negocio», «gasto 500 flete», «meté 3000 en caja», «registrá una salida de caja descripción Pronto $6000». cashType=egreso|ingreso, amount, cashConcept (para qué: flete, Pronto, sueldo). cashAmbitoHint = cómo nombró la caja (personal, negocio, la mía, empresa). Si no nombró caja, OMITÍ cashAmbitoHint. NO es create_purchase aunque diga «compra» en el concepto. NO es cobro de un pedido (register_payment) ni create_order: «ingresa el pedido» es create_order, «ingreso 2000» / «hacé un ingreso» es register_cash. Un egreso NUNCA se copia después como cobro de un pedido.
- update_product_cost: cambiar el costo CONFIGURADO de un producto del catálogo. productName + amount = nuevo costo. Ej: «el costo de Taza AA es 147», «cambiá el costo de Canguro felpa Rojo L a 600». NO es register_cost (eso es extra de un pedido) ni create_purchase.
- register_cost: agregar un ítem de costo extra a un pedido YA guardado (estampado, vinilo, personalización, «sumale al costo»). NO es un gasto de caja ni una compra a proveedor ni un pedido nuevo ni el costo de catálogo. Ejemplos: «en el pedido nro 223 sumale al costo $200», «pedido #00223 sumale 200 al costo», «costo estampado 200», «agregá costo vinilo 150 al pedido de Carola», «al último pedido costo de serigrafía 80». extraCosts = [{ nombre, costo }]. orderNumber si hay número. clientName si nombra a alguien. referToLast=true solo si habla del último y no da número. Si en el mismo mensaje arma un pedido nuevo («pedido para…», «ingresa el pedido de…», «registrá un pedido…»), usá create_order y poné extraCosts en ese pedido.
- Si en un create_order menciona un costo extra («pedido para Ana, buzo 1500, costo estampado 200»), extraCosts va en el pedido; amount es el precio de venta, no el costo.
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
    })) as {
      intent?: string;
      confidence?: number;
      transcript?: string;
      entities?: Record<string, unknown>;
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
  ].includes(rules.intent);
  /** El modelo manda. Reglas solo si Gemini falló, es unknown, o saludó de más. */
  const preferGemini =
    gemini.intent === 'unknown'
      ? false
      : operationalRule && (gemini.intent === 'help' || gemini.intent === 'greeting')
        ? false
        : true;

  const base = preferGemini ? gemini : rules;
  if (base.intent === 'help' || base.intent === 'greeting') return base;

  const ruleEntities = 'entities' in rules ? rules.entities ?? {} : {};
  const geminiEntities = 'entities' in gemini ? gemini.entities ?? {} : {};
  const resolvedMediaId =
    (typeof mediaId === 'string' && mediaId.trim()) ||
    (typeof geminiEntities.mediaId === 'string' && geminiEntities.mediaId.trim()) ||
    (typeof ruleEntities.mediaId === 'string' && ruleEntities.mediaId.trim()) ||
    '';
  const raw = ('raw' in base ? base.raw : '') || ('raw' in rules ? rules.raw : '');
  const entities: WhatsappCommandEntities = enrichEntitiesFromText(
    raw,
    coalesceEntities(ruleEntities, geminiEntities)
  );
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
      PAYMENT_PATTERNS.test(utterance) ||
      PAY_FULL_PATTERNS.test(utterance) ||
      SETTLE_BALANCE_PATTERNS.test(utterance) ||
      Boolean(ruleEntities.payFullBalance || ruleEntities.paid);
    if (!mentionedPay) {
      entities.amount = undefined;
      entities.paid = undefined;
      entities.payFullBalance = undefined;
    }
  }

  const cashRule =
    rules.intent === 'register_cash' &&
    !newOrder &&
    ['create_purchase', 'create_order', 'register_payment', 'register_cost', 'unknown'].includes(
      base.intent
    );

  const cashQueryRule =
    rules.intent === 'query_cash' &&
    ['help', 'greeting', 'query_balance', 'query_status', 'unknown'].includes(base.intent);

  const listOrdersRule =
    rules.intent === 'query_status' &&
    Boolean(ruleEntities.listOrders) &&
    ['unknown', 'help', 'greeting', 'query_balance', 'register_cash'].includes(base.intent);

  const orphanPayRule =
    rules.intent === 'register_payment' &&
    !newOrder &&
    ['unknown', 'help', 'query_status', 'register_cash', 'query_cash'].includes(base.intent);

  const intent = (
    statusUpdate
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

  if (statusUpdate) {
    if (ruleEntities.orderStatus) entities.orderStatus = ruleEntities.orderStatus;
    if (ruleEntities.payFullBalance || ruleEntities.paid) {
      entities.payFullBalance = true;
      entities.paid = true;
    }
  }

  const statusIntent = intent === 'update_order_status' || rules.intent === 'update_order_status';
  if (statusIntent && !newOrder) {
    const utterance = rawForOrder || raw;
    const mentionedPay =
      PAYMENT_PATTERNS.test(utterance) ||
      PAY_FULL_PATTERNS.test(utterance) ||
      SETTLE_BALANCE_PATTERNS.test(utterance) ||
      Boolean(ruleEntities.payFullBalance || ruleEntities.paid);
    if (!mentionedPay) {
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
    isTrivialWhatsappTurn(text) && !hasImage && !hasAudio && !normalized.conversation?.originalIntent;
  const rulesKnowsRead =
    !hasImage &&
    !hasAudio &&
    rules.confidence >= 0.85 &&
    (rules.intent === 'query_cash' ||
      rules.intent === 'query_balance' ||
      rules.intent === 'help' ||
      rules.intent === 'greeting');

  const needsGemini =
    Boolean(process.env.GEMINI_API_KEY?.trim()) && !skipGeminiForChitchat && !rulesKnowsRead;

  const gemini = needsGemini ? await parseWithGeminiGuarded(normalized) : null;
  const imageMediaId = hasAudio ? null : normalized.mediaId;
  const merged = mergeParsed(rules, gemini, imageMediaId);
  if (
    merged.intent === 'unknown' &&
    normalized.conversation?.lastOperation?.id &&
    looksLikeStatusQuery(text)
  ) {
    return {
      intent: 'query_status',
      confidence: 0.85,
      entities: {
        ...('entities' in merged ? merged.entities ?? {} : {}),
        referToLast: true,
        sourceText: text,
      },
      raw: text,
    };
  }
  return merged;
}
