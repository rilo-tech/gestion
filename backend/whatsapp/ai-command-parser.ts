import {
  extractAmountFromText,
  extractClientHintFromText,
  extractDeliveryDateFromText,
  extractOrderDateFromText,
  coerceDateOnly,
} from './lookups.ts';
import { whatsappCopyForRubro } from './copy.ts';
import { assertCanUseAi, incrementAiUsage } from '../auth/usage-gates.ts';

export type WhatsappIntent =
  | 'help'
  | 'greeting'
  | 'create_order'
  | 'create_sale'
  | 'create_purchase'
  | 'register_payment'
  | 'query_balance'
  | 'query_cash'
  | 'register_cash'
  | 'unknown';

export type WhatsappPurchaseLine = {
  productName: string;
  productId?: string;
  quantity: number;
  unitCost: number;
};

export type WhatsappCommandEntities = {
  clientId?: string;
  clientName?: string;
  productId?: string;
  productName?: string;
  quantity?: number;
  amount?: number;
  notes?: string;
  paid?: boolean;
  mediaId?: string;
  imageSummary?: string;
  /** Movimiento de caja manual. */
  cashType?: 'ingreso' | 'egreso';
  cashConcept?: string;
  /** No buscar/crear producto: usar productName como concepto libre. */
  productAsConcept?: boolean;
  /** Fecha de carga YYYY-MM-DD. */
  orderDate?: string;
  /** Fecha de entrega del pedido YYYY-MM-DD. */
  deliveryDate?: string;
  supplierId?: string;
  supplierName?: string;
  invoiceNumber?: string;
  purchaseLines?: WhatsappPurchaseLine[];
  /** Medio de pago de la compra (ids del ERP: efectivo, transferencia, …). */
  paymentMedioId?: string;
  paymentMedioLabel?: string;
  paymentTarjetaId?: string;
  paymentTarjetaLabel?: string;
  paymentCuotas?: number;
  paymentDueDate?: string;
  paymentHint?: string;
  saveAsDraft?: boolean;
  paymentIncompleteReason?: string;
};

export type ParsedWhatsappCommand =
  | { intent: 'help'; confidence: number; raw?: string }
  | { intent: 'greeting'; confidence: number }
  | {
      intent: Exclude<WhatsappIntent, 'help' | 'greeting'>;
      confidence: number;
      entities?: WhatsappCommandEntities;
      raw: string;
    };

export type WhatsappParseInput = {
  text: string;
  image?: { buffer: Buffer; contentType: string } | null;
  mediaId?: string | null;
  rubro?: string | null;
  businessId?: string;
};

const ORDER_PATTERNS = /\b(pedido|orden)\b/i;
const SALE_PATTERNS = /\b(venta|vend[ií])\b/i;
const PURCHASE_PATTERNS =
  /\b(compra|compr[eé]|remito|factura\s+(de\s+)?compra|proveedor|lleg[oó]\s+(la\s+)?mercader[ií]a)\b/i;
const PAYMENT_PATTERNS = /\b(pago|cobro|abon[oó])\b/i;
const BALANCE_PATTERNS = /\b(saldo|debe|cuenta)\b/i;
const CASH_QUERY_PATTERNS =
  /\b(caja\s+(de\s+)?hoy|cu[aá]nto\s+vend[ií]|resumen\s+(de\s+)?caja|movimientos?\s+(de\s+)?caja|cu[aá]nto\s+(hay\s+)?en\s+caja)\b/i;
const CASH_OUT_PATTERNS = /\b(gasto|egreso|salida\s+de\s+caja|retir[eéo]\s+de\s+caja)\b/i;
const CASH_IN_PATTERNS = /\b(ingreso\s+de\s+caja|entrada\s+de\s+caja)\b/i;

const ALLOWED_INTENTS: WhatsappIntent[] = [
  'help',
  'greeting',
  'create_order',
  'create_sale',
  'create_purchase',
  'register_payment',
  'query_balance',
  'query_cash',
  'register_cash',
  'unknown',
];

function enrichEntitiesFromText(
  text: string,
  entities: WhatsappCommandEntities = {}
): WhatsappCommandEntities {
  const next = { ...entities };
  if (next.amount == null) {
    const amount = extractAmountFromText(text);
    if (amount != null) next.amount = amount;
  }
  if (!next.clientName) {
    const hint = extractClientHintFromText(text);
    if (hint) next.clientName = hint;
  }
  if (!next.deliveryDate && /\bentrega/i.test(text)) {
    const delivery = extractDeliveryDateFromText(text);
    if (delivery) next.deliveryDate = delivery;
  }
  if (!next.orderDate) {
    const orderDate = extractOrderDateFromText(text);
    if (orderDate) next.orderDate = orderDate;
  }
  if (!next.notes && text.trim()) next.notes = text.trim();
  if (!next.supplierName) {
    const supplierHint = text.match(
      /\b(?:compra(?:\s+a)?|proveedor)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .&'-]{1,50})/i
    );
    if (supplierHint?.[1]) {
      next.supplierName = supplierHint[1].trim().replace(/[.,;:!?]+$/, '');
    }
  }
  if (!next.purchaseLines?.length) {
    const lines = parsePurchaseLinesFromText(text);
    if (lines?.length) next.purchaseLines = lines;
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
    lines.push({ productName, quantity, unitCost });
  }
  return lines.length ? lines : undefined;
}

function parseWithRules(message: string): ParsedWhatsappCommand {
  const text = message.trim();
  if (!text) {
    return { intent: 'unknown', confidence: 0, raw: text };
  }

  const lower = text.toLowerCase();
  if (/^(hola|holaa+|buenas|buen[oa]s?\s+d[ií]as?|buen[oa]s?\s+tardes?|hey|hello)[\s!¡?.]*$/i.test(lower)) {
    return { intent: 'greeting', confidence: 0.9 };
  }
  if (
    /\b(consultame|consultáme|ayuda|help|comandos|c[oó]mo (funciona|uso|registro|anoto|hablo)|qu[eé] (pod[eé]s|podes|puedes) hacer|qu[eé] hac[eé]s|ejemplos?|productos?|cat[aá]logo)\b/i.test(
      lower
    )
  ) {
    return { intent: 'help', confidence: 0.92, raw: text };
  }

  const entities = enrichEntitiesFromText(text);
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
  if (BALANCE_PATTERNS.test(text)) {
    return { intent: 'query_balance', confidence: 0.7, entities, raw: text };
  }
  if (CASH_QUERY_PATTERNS.test(text)) {
    return { intent: 'query_cash', confidence: 0.75, entities, raw: text };
  }
  if (CASH_OUT_PATTERNS.test(text) || CASH_IN_PATTERNS.test(text)) {
    const cashType: 'ingreso' | 'egreso' = CASH_OUT_PATTERNS.test(text) ? 'egreso' : 'ingreso';
    const concept =
      text
        .replace(CASH_OUT_PATTERNS, '')
        .replace(CASH_IN_PATTERNS, '')
        .replace(/\$?\s*[\d.,]+/g, '')
        .replace(/\s+/g, ' ')
        .trim() || (cashType === 'egreso' ? 'Gasto' : 'Ingreso');
    return {
      intent: 'register_cash',
      confidence: 0.7,
      entities: { ...entities, cashType, cashConcept: concept },
      raw: text,
    };
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
    const quantity = Math.max(1, Number(row.quantity ?? row.cantidad) || 1);
    const unitCost = Math.max(0, Number(row.unitCost ?? row.costoUnitario ?? row.costo) || 0);
    const productId = String(row.productId ?? '').trim();
    lines.push({
      productName,
      ...(productId ? { productId } : {}),
      quantity,
      unitCost,
    });
  }
  return lines.length ? lines : undefined;
}

function normalizeGeminiResult(
  parsed: {
    intent?: string;
    confidence?: number;
    entities?: Record<string, unknown>;
  },
  raw: string,
  mediaId?: string | null
): ParsedWhatsappCommand {
  const intent = (parsed.intent ?? 'unknown') as WhatsappIntent;
  if (!ALLOWED_INTENTS.includes(intent)) {
    return { intent: 'unknown', confidence: 0.3, raw, entities: { mediaId: mediaId ?? undefined } };
  }

  if (intent === 'help') {
    return { intent, confidence: Number(parsed.confidence) || 0.8, raw };
  }
  if (intent === 'greeting') {
    return { intent, confidence: Number(parsed.confidence) || 0.8 };
  }

  const rawEntities = parsed.entities ?? {};
  const entities: WhatsappCommandEntities = enrichEntitiesFromText(raw, {
    clientName:
      typeof rawEntities.clientName === 'string' ? rawEntities.clientName.trim() : undefined,
    productName:
      typeof rawEntities.productName === 'string' ? rawEntities.productName.trim() : undefined,
    quantity:
      typeof rawEntities.quantity === 'number'
        ? rawEntities.quantity
        : Number(rawEntities.quantity) || undefined,
    amount:
      typeof rawEntities.amount === 'number'
        ? rawEntities.amount
        : Number(rawEntities.amount) || undefined,
    notes: typeof rawEntities.notes === 'string' ? rawEntities.notes.trim() : undefined,
    paid: rawEntities.paid === true || String(rawEntities.paid).toLowerCase() === 'true',
    imageSummary:
      typeof rawEntities.imageSummary === 'string' ? rawEntities.imageSummary.trim() : undefined,
    mediaId: mediaId ?? undefined,
    cashType:
      rawEntities.cashType === 'egreso' || rawEntities.cashType === 'ingreso'
        ? rawEntities.cashType
        : undefined,
    cashConcept:
      typeof rawEntities.cashConcept === 'string' ? rawEntities.cashConcept.trim() : undefined,
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
  });

  return {
    intent,
    confidence: Number(parsed.confidence) || 0.7,
    entities,
    raw,
  };
}

async function parseWithGemini(input: WhatsappParseInput): Promise<ParsedWhatsappCommand | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const message = input.text.trim() || '(sin texto, solo imagen)';
    const copy = whatsappCopyForRubro(input.rubro);
    const productRule = copy.hasProductExamples
      ? `- productName: conservá exactamente lo que el usuario dijo. En este negocio el rubro es conocido; un ejemplo de cómo puede venir: «${copy.exampleProduct}». No inventes ítems. No simplifiques quitando detalle (peso, sabor, tamaño, color, talle) si lo dijo.`
      : '- productName: conservá exactamente lo que el usuario dijo. No inventes un producto ni asumas un rubro (ni comida, ni ropa, ni servicios). No simplifiques quitando detalle si lo dijo.';
    const prompt = `Sos el parser de RiloBot, un ERP por WhatsApp para negocios pequeños (Uruguay/Latam).
Clasificá el mensaje y, si hay imagen, usala como referencia (pedido, venta o compra a proveedor).
Devolvé SOLO JSON válido con:
- intent: help|greeting|create_order|create_sale|create_purchase|register_payment|query_balance|query_cash|register_cash|unknown
- confidence: 0-1
- entities: objeto opcional con clientName, supplierName, productName, quantity, amount (número), notes, paid (boolean), imageSummary, cashType (ingreso|egreso), cashConcept, orderDate (YYYY-MM-DD), deliveryDate (YYYY-MM-DD), invoiceNumber, purchaseLines (array de { productName, quantity, unitCost }), paymentMethod (efectivo|transferencia|debito|mercado_pago|tarjeta|proveedor si se ve o lo dijo), paymentCuotas (número)

Reglas:
- greeting: solo un saludo corto (hola, buenas), sin pedido de ayuda.
- help: pregunta cómo funciona, qué puede hacer, productos, ejemplos, cómo registrar, o escribe «consultame» / «ayuda».
${productRule}
- clientName: nombre completo (nombre y apellido) si el usuario lo dijo. No recortes el apellido.
- create_order: si solo dice «pedido» sin datos, igual intent create_order con entities vacías.
- deliveryDate: fecha de entrega del pedido si la mencionó (entrega el viernes, 20/08, 20 de agosto).
- orderDate: fecha de carga si la mencionó; si no, no inventes (queda hoy).
- create_purchase: compra a proveedor, remito, factura de compra, foto de ticket/factura del mayorista, o «llegó mercadería». Extraé supplierName y purchaseLines (cantidad y costo unitario de cada ítem). amount = total de la compra si se ve. Si se ve o dice cómo pagó (efectivo, transferencia, tarjeta, fiado), ponelo en paymentMethod. No inventes el medio de pago.
- Si hay foto de factura/remito/ticket de proveedor (CUIT, IVA, razón social, ítems con costo), preferí create_purchase.
- Si hay foto de pedido/lista de cliente y no está claro, preferí create_order.
- amount en número (sin símbolo $).
- No inventes clientes, proveedores ni montos si no aparecen.
- query_cash: resumen de caja del día / cuánto se vendió o cobró.
- register_cash: gasto/egreso o ingreso manual de caja (no es venta a cliente ni compra a proveedor).

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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: [{ role: 'user', parts }],
      config: { responseMimeType: 'application/json' },
    });

    const rawText = response.text?.trim();
    if (!rawText) return null;
    const parsed = JSON.parse(rawText) as {
      intent?: string;
      confidence?: number;
      entities?: Record<string, unknown>;
    };
    return normalizeGeminiResult(parsed, message, input.mediaId);
  } catch (error) {
    console.warn('[whatsapp] Gemini parser fallback:', error);
    return null;
  }
}

async function parseWithGeminiGuarded(input: WhatsappParseInput): Promise<ParsedWhatsappCommand | null> {
  const hasImage = Boolean(input.image?.buffer?.length);
  const cost = hasImage ? 2 : 1;
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
  if (!gemini) {
    if ('entities' in rules) {
      return {
        ...rules,
        entities: { ...rules.entities, mediaId: mediaId ?? rules.entities?.mediaId },
      };
    }
    return rules;
  }

  const preferGemini =
    gemini.confidence >= (rules.confidence ?? 0) ||
    (rules.intent === 'unknown' && gemini.intent !== 'unknown');

  const base = preferGemini ? gemini : rules;
  if (base.intent === 'help' || base.intent === 'greeting') return base;

  const ruleEntities = 'entities' in rules ? rules.entities ?? {} : {};
  const geminiEntities = 'entities' in gemini ? gemini.entities ?? {} : {};
  const entities: WhatsappCommandEntities = {
    ...ruleEntities,
    ...geminiEntities,
    mediaId: mediaId ?? geminiEntities.mediaId ?? ruleEntities.mediaId,
  };

  return {
    intent: base.intent as Exclude<WhatsappIntent, 'help' | 'greeting'>,
    confidence: Math.max(rules.confidence ?? 0, gemini.confidence ?? 0),
    entities,
    raw: 'raw' in base ? base.raw : 'raw' in rules ? rules.raw : '',
  };
}

/** Parser con reglas + Gemini (texto y/o imagen). */
export async function parseWhatsappCommand(
  input: string | WhatsappParseInput
): Promise<ParsedWhatsappCommand> {
  const normalized: WhatsappParseInput =
    typeof input === 'string' ? { text: input } : input;

  const text = normalized.text.trim();
  const hasImage = Boolean(normalized.image?.buffer?.length);

  if (!text && !hasImage) {
    return { intent: 'unknown', confidence: 0, raw: '', entities: {} };
  }

  const rules = text
    ? parseWithRules(text)
    : ({
        intent: 'unknown',
        confidence: 0.2,
        entities: { notes: 'Mensaje con foto de WhatsApp' },
        raw: '',
      } satisfies ParsedWhatsappCommand);

  const needsGemini =
    Boolean(process.env.GEMINI_API_KEY?.trim()) &&
    (hasImage ||
      rules.confidence < 0.85 ||
      ('entities' in rules &&
        !rules.entities?.clientName &&
        ['create_order', 'create_sale', 'create_purchase', 'register_payment', 'query_balance', 'query_cash', 'register_cash'].includes(
          rules.intent
        )));

  const gemini = needsGemini ? await parseWithGeminiGuarded(normalized) : null;
  return mergeParsed(rules, gemini, normalized.mediaId);
}
