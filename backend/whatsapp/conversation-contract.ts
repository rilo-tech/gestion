export const CONVERSATION_ACTIONS = [
  'continue_current',
  'new_task',
  'correct_current',
  'cancel_current',
  'confirm_current',
  'answer_current',
] as const;

export type ConversationAction = (typeof CONVERSATION_ACTIONS)[number];

export const TASK_STATUSES = [
  'collecting',
  'resolving',
  'clarifying',
  'confirming',
  'executing',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type LineItemAttributes = {
  type?: string | null;
  fabric?: string | null;
  model?: string | null;
  color?: string | null;
  size?: string | null;
  variant?: string | null;
};

export type LineItemIntent = {
  quantity: number;
  rawText: string;
  productHint?: string;
  attributes?: LineItemAttributes;
  unitPrice?: number | null;
  unitCost?: number | null;
  productId?: string;
  productName?: string;
  spokenProductName?: string;
  skipped?: boolean;
  productLocked?: boolean;
  invoiceName?: string;
  tipoLinea?: 'stock' | 'insumo' | 'concepto';
  /** Identidad estable del renglón durante el turno. La resolución no cambia este key. */
  itemKey?: string;
  sourceSpan?: string;
  rawSpan?: string;
  sourceTurnId?: string;
  description?: string;
  resolvedEntity?: { id: string; name: string };
};

export type ParsedParty = {
  raw?: string;
  name?: string;
  phone?: string;
  id?: string;
};

export type AwaitingSlot = {
  type:
    | 'field'
    | 'product_choice'
    | 'client_choice'
    | 'supplier_choice'
    | 'order_choice'
    | 'confirmation'
    | 'multi_choice';
  field?: string;
  itemIndex?: number;
  options?: Array<{ index: number; id?: string; label: string }>;
  prompt?: string;
};

export type MatchDecision = 'advance' | 'confirm' | 'ask';

const MAX_ITEMS = 40;

function asTrimmed(value: unknown): string {
  return String(value ?? '').trim();
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function asAttributes(raw: unknown): LineItemAttributes | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const attributes: LineItemAttributes = {
    type: asTrimmed(row.type || row.tipo) || null,
    fabric: asTrimmed(row.fabric || row.tela) || null,
    model: asTrimmed(row.model || row.modelo) || null,
    color: asTrimmed(row.color) || null,
    size: asTrimmed(row.size || row.talle) || null,
    variant: asTrimmed(row.variant || row.variante) || null,
  };
  return Object.values(attributes).some(Boolean) ? attributes : undefined;
}

export function parseLineItem(raw: unknown): LineItemIntent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const rawText =
    asTrimmed(row.rawText || row.descripcion || row.productName || row.nombre || row.invoiceName) ||
    '';
  const productHint = asTrimmed(row.productHint || row.productName || row.nombre);
  if (!rawText && !productHint) return null;
  const quantity = Math.max(1, asOptionalNumber(row.quantity ?? row.cantidad) || 1);
  const productId = asTrimmed(row.productId);
  const tipoRaw = asTrimmed(row.tipoLinea).toLowerCase();
  const item: LineItemIntent = {
    quantity,
    rawText: rawText || productHint,
    productHint: productHint || undefined,
    attributes: asAttributes(row.attributes ?? row),
    unitPrice: asOptionalNumber(row.unitPrice ?? row.precio) ?? null,
    unitCost: asOptionalNumber(row.unitCost ?? row.costo) ?? null,
    spokenProductName: asTrimmed(row.spokenProductName) || undefined,
    skipped: row.skipped === true,
    productLocked: row.productLocked === true,
    invoiceName: asTrimmed(row.invoiceName) || undefined,
  };
  if (productId) item.productId = productId;
  const productName = asTrimmed(row.productName || row.nombre);
  if (productName) item.productName = productName;
  if (tipoRaw === 'insumo' || tipoRaw === 'stock' || tipoRaw === 'concepto') {
    item.tipoLinea = tipoRaw;
  }
  const itemKey = asTrimmed(row.itemKey);
  if (itemKey) item.itemKey = itemKey;
  const sourceSpan = asTrimmed(row.sourceSpan || row.rawSpan || row.rawText);
  if (sourceSpan) {
    item.sourceSpan = item.sourceSpan || sourceSpan;
    item.rawSpan = item.rawSpan || sourceSpan;
  }
  const sourceTurnId = asTrimmed(row.sourceTurnId);
  if (sourceTurnId) item.sourceTurnId = sourceTurnId;
  const resolvedId = asTrimmed(row.resolvedEntity && typeof row.resolvedEntity === 'object' ? (row.resolvedEntity as { id?: string }).id : '');
  const resolvedName = asTrimmed(
    row.resolvedEntity && typeof row.resolvedEntity === 'object' ? (row.resolvedEntity as { name?: string }).name : ''
  );
  if (resolvedId || resolvedName) {
    item.resolvedEntity = { id: resolvedId || productId, name: resolvedName || productName };
  } else if (productId || productName) {
    item.resolvedEntity = productId ? { id: productId, name: productName || rawText || productHint } : undefined;
  }
  return item;
}

export function parseLineItems(raw: unknown): LineItemIntent[] {
  if (!Array.isArray(raw)) return [];
  const items: LineItemIntent[] = [];
  for (const row of raw.slice(0, MAX_ITEMS)) {
    const item = parseLineItem(row);
    if (item) items.push(item);
  }
  return items;
}

export function catalogQueryForItem(item: LineItemIntent): string {
  const attributes = item.attributes ?? {};
  const type = asTrimmed(attributes.type);
  const hint = asTrimmed(item.productHint);
  const raw = asTrimmed(item.rawText);
  const head = type || firstProductHead(hint || raw);
  const parts = [head, attributes.fabric, attributes.model, attributes.color, attributes.size]
    .map((value) => asTrimmed(value))
    .filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    const folded = part.toLowerCase();
    if (!folded) continue;
    if (unique.some((existing) => existing.toLowerCase() === folded)) continue;
    unique.push(part);
  }
  return unique.join(' ').trim() || asTrimmed(item.productName) || raw;
}

function firstProductHead(text: string): string {
  const tokens = asTrimmed(text)
    .split(/\s+/)
    .filter((token) => token && !/^(un|una|unos|unas|el|la|de|con)$/i.test(token));
  return tokens[0] ?? asTrimmed(text);
}

export function looksLikeConcatenatedItems(text: string): boolean {
  const raw = asTrimmed(text);
  if (!raw) return false;
  return /\d+\s+.+\s+y\s+\d+\s+/i.test(raw);
}

/** Fallback si Gemini no separó ítems: solo corta en «N … y N …». */
export function splitConcatenatedProductText(text: string): LineItemIntent[] {
  const raw = asTrimmed(text);
  if (!looksLikeConcatenatedItems(raw)) return [];
  const parts = raw.split(/\s+y\s+(?=\d+\s)/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  const items: LineItemIntent[] = [];
  for (const part of parts.slice(0, MAX_ITEMS)) {
    const match = part.match(/^(\d+)\s+(.+)$/);
    const quantity = match ? Math.max(1, Number(match[1]) || 1) : 1;
    const rest = (match?.[2] ?? part).trim();
    if (!rest) continue;
    items.push({
      quantity,
      rawText: rest,
      productHint: rest,
      spokenProductName: rest,
    });
  }
  return items.length >= 2 ? items : [];
}

export function parseConversationAction(raw: unknown): ConversationAction | undefined {
  const value = asTrimmed(raw);
  if ((CONVERSATION_ACTIONS as readonly string[]).includes(value)) {
    return value as ConversationAction;
  }
  if (value === 'continue' || value === 'continue_current') return 'continue_current';
  if (value === 'new' || value === 'new_task') return 'new_task';
  if (value === 'cancel' || value === 'cancel_current') return 'cancel_current';
  if (value === 'confirm' || value === 'confirm_current') return 'confirm_current';
  if (value === 'correct' || value === 'correct_current') return 'correct_current';
  if (value === 'choose' || value === 'ask' || value === 'answer' || value === 'answer_current') {
    return 'answer_current';
  }
  return undefined;
}

export function followUpToConversationAction(action?: string | null): ConversationAction {
  return parseConversationAction(action) ?? 'continue_current';
}

export function decideMatchAction(input: {
  geminiConfidence?: number;
  catalogScore?: number;
  unique: boolean;
  memoryConfirmations?: number;
}): MatchDecision {
  const gemini = Number(input.geminiConfidence) || 0;
  const catalog = Number(input.catalogScore) || 0;
  const memory = Number(input.memoryConfirmations) || 0;
  const combined =
    Math.max(gemini, 0) * 0.45 + Math.min(1, catalog / 100) * 0.45 + Math.min(1, memory / 3) * 0.1;
  if (input.unique && catalog >= 95 && combined >= 0.65) return 'advance';
  if (input.unique && catalog >= 80 && combined >= 0.9) return 'advance';
  if (combined >= 0.9 && input.unique) return 'advance';
  if (combined >= 0.65) return 'confirm';
  return 'ask';
}

export function isValidTurnJson(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const row = raw as Record<string, unknown>;
  if (row.intent != null && typeof row.intent !== 'string') return false;
  if (row.items != null && !Array.isArray(row.items)) return false;
  if (row.entities && typeof row.entities === 'object' && !Array.isArray(row.entities)) {
    const entities = row.entities as Record<string, unknown>;
    if (entities.items != null && !Array.isArray(entities.items)) return false;
  }
  return true;
}

export const GEMINI_TURN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
    conversationAction: { type: 'STRING' },
    followUpAction: { type: 'STRING' },
    choiceIndex: { type: 'INTEGER' },
    choiceIndexes: { type: 'ARRAY', items: { type: 'INTEGER' } },
    requiresClarification: { type: 'BOOLEAN' },
    clarificationReason: { type: 'STRING' },
    transcript: { type: 'STRING' },
    client: {
      type: 'OBJECT',
      properties: {
        raw: { type: 'STRING' },
        name: { type: 'STRING' },
        phone: { type: 'STRING' },
      },
    },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          quantity: { type: 'NUMBER' },
          rawText: { type: 'STRING' },
          productHint: { type: 'STRING' },
          productName: { type: 'STRING' },
          itemKey: { type: 'STRING' },
          sourceSpan: { type: 'STRING' },
          attributes: {
            type: 'OBJECT',
            properties: {
              type: { type: 'STRING' },
              fabric: { type: 'STRING' },
              model: { type: 'STRING' },
              color: { type: 'STRING' },
              size: { type: 'STRING' },
              variant: { type: 'STRING' },
            },
          },
        },
        required: ['rawText'],
      },
    },
    entities: { type: 'OBJECT' },
  },
  required: ['intent'],
} as const;
