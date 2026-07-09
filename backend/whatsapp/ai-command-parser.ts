export type ParsedWhatsappCommand =
  | { intent: 'help'; confidence: number }
  | { intent: 'greeting'; confidence: number }
  | {
      intent: 'create_order' | 'create_sale' | 'register_payment' | 'query_balance' | 'unknown';
      confidence: number;
      entities?: Record<string, string | number>;
      raw: string;
    };

const ORDER_PATTERNS = /\b(pedido|orden)\b/i;
const SALE_PATTERNS = /\b(venta|vend[ií])\b/i;
const PAYMENT_PATTERNS = /\b(pago|cobro|abon[oó])\b/i;
const BALANCE_PATTERNS = /\b(saldo|debe|cuenta)\b/i;

function parseWithRules(message: string): ParsedWhatsappCommand {
  const text = message.trim();
  if (!text) {
    return { intent: 'unknown', confidence: 0, raw: text };
  }

  const lower = text.toLowerCase();
  if (/^(hola|buenas|buen dia|buenos dias|hey)\b/.test(lower)) {
    return { intent: 'greeting', confidence: 0.9, raw: text };
  }
  if (/\b(ayuda|help|comandos)\b/i.test(text)) {
    return { intent: 'help', confidence: 0.95, raw: text };
  }
  if (ORDER_PATTERNS.test(text)) {
    return { intent: 'create_order', confidence: 0.75, entities: {}, raw: text };
  }
  if (SALE_PATTERNS.test(text)) {
    return { intent: 'create_sale', confidence: 0.75, entities: {}, raw: text };
  }
  if (PAYMENT_PATTERNS.test(text)) {
    return { intent: 'register_payment', confidence: 0.7, entities: {}, raw: text };
  }
  if (BALANCE_PATTERNS.test(text)) {
    return { intent: 'query_balance', confidence: 0.7, entities: {}, raw: text };
  }

  return { intent: 'unknown', confidence: 0.2, raw: text };
}

async function parseWithGemini(message: string): Promise<ParsedWhatsappCommand | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Clasificá este mensaje de WhatsApp para un ERP de negocios pequeños.
Devolvé SOLO JSON válido con: intent (help|greeting|create_order|create_sale|register_payment|query_balance|unknown), confidence (0-1), entities (objeto opcional con clientName, amount, notes).
Mensaje: "${message}"`,
            },
          ],
        },
      ],
      config: { responseMimeType: 'application/json' },
    });

    const rawText = response.text?.trim();
    if (!rawText) return null;
    const parsed = JSON.parse(rawText) as {
      intent?: string;
      confidence?: number;
      entities?: Record<string, string | number>;
    };
    const intent = parsed.intent ?? 'unknown';
    const allowed = [
      'help',
      'greeting',
      'create_order',
      'create_sale',
      'register_payment',
      'query_balance',
      'unknown',
    ];
    if (!allowed.includes(intent)) {
      return { intent: 'unknown', confidence: 0.3, raw: message };
    }
    if (intent === 'help' || intent === 'greeting') {
      return { intent, confidence: parsed.confidence ?? 0.8 };
    }
    return {
      intent: intent as Exclude<ParsedWhatsappCommand['intent'], 'help' | 'greeting'>,
      confidence: parsed.confidence ?? 0.7,
      entities: parsed.entities,
      raw: message,
    };
  } catch (error) {
    console.warn('[whatsapp] Gemini parser fallback:', error);
    return null;
  }
}

/** Parser con reglas; usa Gemini si hay API key y la confianza de reglas es baja. */
export async function parseWhatsappCommand(message: string): Promise<ParsedWhatsappCommand> {
  const rules = parseWithRules(message);
  if (rules.confidence >= 0.7 || rules.intent === 'help' || rules.intent === 'greeting') {
    return rules;
  }

  const gemini = await parseWithGemini(message);
  if (gemini && gemini.confidence >= (rules.confidence ?? 0)) {
    return gemini;
  }

  return rules;
}
