import {
  extractAmountFromText,
  extractClientHintFromText,
} from './lookups.ts';

export type WhatsappIntent =
  | 'help'
  | 'greeting'
  | 'create_order'
  | 'create_sale'
  | 'register_payment'
  | 'query_balance'
  | 'query_cash'
  | 'register_cash'
  | 'unknown';

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
};

export type ParsedWhatsappCommand =
  | { intent: 'help'; confidence: number }
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
};

const ORDER_PATTERNS = /\b(pedido|orden)\b/i;
const SALE_PATTERNS = /\b(venta|vend[ií])\b/i;
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
  if (!next.notes && text.trim()) next.notes = text.trim();
  return next;
}

function parseWithRules(message: string): ParsedWhatsappCommand {
  const text = message.trim();
  if (!text) {
    return { intent: 'unknown', confidence: 0, raw: text };
  }

  const lower = text.toLowerCase();
  if (/^(hola|buenas|buen dia|buenos dias|hey)\b/.test(lower)) {
    return { intent: 'greeting', confidence: 0.9 };
  }
  if (/\b(ayuda|help|comandos)\b/i.test(text)) {
    return { intent: 'help', confidence: 0.95 };
  }

  const entities = enrichEntitiesFromText(text);
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

  if (intent === 'help' || intent === 'greeting') {
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
    const prompt = `Sos el parser de RiloBot, un ERP por WhatsApp para negocios pequeños (Uruguay/Latam).
Clasificá el mensaje y, si hay imagen, usala como referencia del pedido/venta (producto, cantidad, monto manuscrito, etc.).
Devolvé SOLO JSON válido con:
- intent: help|greeting|create_order|create_sale|register_payment|query_balance|query_cash|register_cash|unknown
- confidence: 0-1
- entities: objeto opcional con clientName, productName, quantity, amount (número), notes, paid (boolean), imageSummary, cashType (ingreso|egreso), cashConcept

Reglas:
- Si hay foto de pedido/lista/producto y no está claro, preferí create_order.
- amount en número (sin símbolo $).
- No inventes clientes ni montos si no aparecen.
- query_cash: resumen de caja del día / cuánto se vendió o cobró.
- register_cash: gasto/egreso o ingreso manual de caja (no es venta a cliente).
- Stock, compras y proveedores NO son intents de WhatsApp.

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
      model: 'gemini-2.0-flash',
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
        intent: 'create_order',
        confidence: 0.4,
        entities: { notes: 'Pedido desde foto de WhatsApp' },
        raw: '',
      } satisfies ParsedWhatsappCommand);

  const needsGemini =
    Boolean(process.env.GEMINI_API_KEY?.trim()) &&
    (hasImage ||
      rules.confidence < 0.85 ||
      ('entities' in rules &&
        !rules.entities?.clientName &&
        ['create_order', 'create_sale', 'register_payment', 'query_balance', 'query_cash', 'register_cash'].includes(
          rules.intent
        )));

  const gemini = needsGemini ? await parseWithGemini(normalized) : null;
  return mergeParsed(rules, gemini, normalized.mediaId);
}
