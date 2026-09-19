/**
 * Contexto genérico de la última operación / registros relevantes (V4).
 * Reutilizable por cualquier entidad: productos, clientes, pedidos, etc.
 * No interpreta español: solo estructura + IDs ordenados + TTL.
 */
import type { AgentOperationPlan } from './agent/tool-types.ts';
import type {
  ConversationFocusEntities,
  ConversationListContext,
  ConversationState,
  LastWhatsappOperation,
} from './conversation-state.ts';
import type { LastPresentedEntities } from './v4-conversation-context.ts';

export const RECENT_OPERATION_TTL_MS = 30 * 60 * 1000;

export type RecentOperationEntityKind =
  | 'order'
  | 'sale'
  | 'purchase'
  | 'payment'
  | 'cash'
  | 'client'
  | 'product'
  | 'supplier'
  | 'collaborator'
  | 'stock'
  | 'payable'
  | 'other';

export type RecentOperationContext = {
  entityKind: RecentOperationEntityKind;
  /** Acción semántica corta: create | update | rename | register | list | select | … */
  action: string;
  /** Tool V4 que originó el contexto (si aplica). */
  tool?: string;
  /** IDs ERP en el orden presentado/afectado (1-based para el usuario). */
  recordIds: string[];
  /** Etiquetas paralelas a recordIds (nombres / #pedido). */
  labels?: string[];
  primaryId?: string;
  summary?: string;
  at: string;
  expiresAt: string;
};

const LIST_TYPE_BY_ENTITY: Partial<
  Record<RecentOperationEntityKind, ConversationListContext['type']>
> = {
  product: 'products',
  client: 'clients',
  order: 'orders',
  stock: 'stock',
};

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((row) => String(row ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function uniquePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isRecentOperationFresh(
  recent: RecentOperationContext | null | undefined,
  nowMs = Date.now()
): recent is RecentOperationContext {
  if (!recent?.recordIds?.length) return false;
  const expires = Date.parse(String(recent.expiresAt ?? ''));
  if (Number.isFinite(expires)) return expires > nowMs;
  // Compat: docs viejos sin expiresAt → usar `at` + TTL.
  const at = Date.parse(String(recent.at ?? ''));
  if (!Number.isFinite(at)) return false;
  return at + RECENT_OPERATION_TTL_MS > nowMs;
}

export function getFreshRecentOperation(
  state: ConversationState | null | undefined,
  nowMs = Date.now()
): RecentOperationContext | null {
  const recent = state?.recentOperation ?? null;
  return isRecentOperationFresh(recent, nowMs) ? recent : null;
}

/** Índice 1-based del usuario → id, o null si fuera de rango / sin contexto. */
export function resolveRecentRecordIdByIndex(
  recent: RecentOperationContext | null | undefined,
  index1Based: number
): string | null {
  if (!isRecentOperationFresh(recent)) return null;
  const idx = Math.trunc(Number(index1Based));
  if (!Number.isFinite(idx) || idx < 1) return null;
  return recent.recordIds[idx - 1] ?? null;
}

function actionFromTool(tool: string): string {
  const t = tool.toLowerCase();
  if (t.startsWith('create_') || t.startsWith('prepare_create')) return 'create';
  if (t.startsWith('rename_')) return 'rename';
  if (t.startsWith('update_') || t.startsWith('prepare_update')) return 'update';
  if (t.startsWith('register_') || t.startsWith('collect_') || t.startsWith('add_')) return 'register';
  if (t.startsWith('adjust_') || t.startsWith('set_')) return 'update';
  if (t.startsWith('list_') || t.startsWith('find_') || t.startsWith('get_') || t.startsWith('preview_')) {
    return 'list';
  }
  return 'update';
}

function entityKindFromToolAndData(
  tool: string,
  data: Record<string, unknown>
): RecentOperationEntityKind {
  const kindHint = String(data.kind ?? '').trim().toLowerCase();
  if (kindHint === 'product' || kindHint === 'product_rename') return 'product';
  if (kindHint === 'client') return 'client';
  if (kindHint === 'supplier') return 'supplier';
  if (kindHint === 'collaborator' || kindHint === 'collaborator_movement') return 'collaborator';
  if (kindHint === 'order') return 'order';
  if (kindHint === 'sale') return 'sale';
  if (kindHint === 'purchase') return 'purchase';
  if (kindHint === 'payment') return 'payment';
  if (kindHint === 'cash') return 'cash';
  if (kindHint === 'recurring_payable' || kindHint === 'payable') return 'payable';
  if (kindHint === 'stock') return 'stock';

  if (tool.includes('product') || tool.includes('stock') || tool.includes('rename')) {
    if (tool.includes('stock')) return 'stock';
    return 'product';
  }
  if (tool.includes('client')) return 'client';
  if (tool.includes('supplier')) return 'supplier';
  if (tool.includes('collaborator')) return 'collaborator';
  if (tool.includes('order') || tool.includes('payment') || tool.includes('deposit') || tool.includes('balance')) {
    if (tool.includes('payment') || tool.includes('deposit') || tool.includes('balance')) return 'payment';
    return 'order';
  }
  if (tool.includes('sale')) return 'sale';
  if (tool.includes('purchase') || tool.includes('visual_draft')) return 'purchase';
  if (tool.includes('cash')) return 'cash';
  if (tool.includes('payable')) return 'payable';
  return 'other';
}

function extractRecordIds(
  entityKind: RecentOperationEntityKind,
  data: Record<string, unknown>,
  writeArgs?: Record<string, unknown>
): string[] {
  const fromData = [
    ...asStringArray(data.productIds),
    ...asStringArray(data.recordIds),
    ...asStringArray(data.orderIds),
    ...asStringArray(data.clientIds),
    ...asStringArray(data.collaboratorIds),
  ];
  const singles: Array<[RecentOperationEntityKind | 'any', string]> = [
    ['product', String(data.productId ?? writeArgs?.productId ?? '')],
    ['client', String(data.clientId ?? writeArgs?.clientId ?? '')],
    ['order', String(data.orderId ?? writeArgs?.orderId ?? '')],
    ['sale', String(data.ventaId ?? writeArgs?.ventaId ?? '')],
    ['purchase', String(data.compraId ?? writeArgs?.compraId ?? '')],
    ['supplier', String(data.supplierId ?? writeArgs?.supplierId ?? '')],
    ['collaborator', String(data.collaboratorId ?? writeArgs?.colaboradorId ?? '')],
    ['cash', String(data.movementId ?? data.cashAccountId ?? writeArgs?.cashAccountId ?? '')],
    ['payable', String(data.obligacionId ?? '')],
    ['any', String(data.id ?? '')],
  ];
  for (const [kind, id] of singles) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    if (kind === 'any' || kind === entityKind) fromData.push(trimmed);
  }
  if (entityKind === 'payment') {
    const orderId = String(data.orderId ?? writeArgs?.orderId ?? '').trim();
    if (orderId) fromData.push(orderId);
  }
  const fromArgs = [
    ...asStringArray(writeArgs?.productIds),
    ...asStringArray(writeArgs?.recordIds),
  ];
  return uniquePreserveOrder([...fromData, ...fromArgs]);
}

function extractLabels(
  data: Record<string, unknown>,
  writeArgs?: Record<string, unknown>,
  recordIds?: string[]
): string[] | undefined {
  const labels = [
    ...asStringArray(data.labels),
    ...asStringArray(data.productNames),
    ...asStringArray(data.names),
  ];
  if (labels.length) return labels.slice(0, recordIds?.length || labels.length);
  const single = String(
    data.productName ??
      data.clientName ??
      data.collaboratorName ??
      data.label ??
      data.name ??
      writeArgs?.newBaseName ??
      ''
  ).trim();
  if (single && recordIds?.length === 1) return [single];
  if (single && recordIds?.length) return recordIds.map((_, i) => (i === 0 ? single : ''));
  return undefined;
}

export function buildRecentOperation(
  input: {
    entityKind: RecentOperationEntityKind;
    action: string;
    tool?: string;
    recordIds: string[];
    labels?: string[];
    primaryId?: string;
    summary?: string;
    at?: string;
    ttlMs?: number;
  }
): RecentOperationContext | null {
  const recordIds = uniquePreserveOrder(input.recordIds.map((id) => String(id ?? '').trim()).filter(Boolean));
  if (!recordIds.length) return null;
  const at = input.at || new Date().toISOString();
  const ttl = input.ttlMs ?? RECENT_OPERATION_TTL_MS;
  const atMs = Date.parse(at);
  const expiresAt = new Date((Number.isFinite(atMs) ? atMs : Date.now()) + ttl).toISOString();
  return {
    entityKind: input.entityKind,
    action: input.action || 'update',
    tool: input.tool,
    recordIds,
    labels: input.labels?.length ? input.labels : undefined,
    primaryId: input.primaryId || recordIds[0],
    summary: input.summary,
    at,
    expiresAt,
  };
}

export function buildRecentOperationFromWrite(
  plan: AgentOperationPlan,
  data: Record<string, unknown> | null | undefined
): RecentOperationContext | null {
  const write = plan.writes[0];
  if (!write) return null;
  const tool = String(write.tool ?? '').trim();
  const payload = data ?? {};
  const entityKind = entityKindFromToolAndData(tool, payload);
  const recordIds = extractRecordIds(entityKind, payload, write.args as Record<string, unknown>);
  const labels = extractLabels(payload, write.args as Record<string, unknown>, recordIds);
  const count = Number(payload.count);
  const summary =
    Number.isFinite(count) && count > 0
      ? `${tool}:${count}`
      : labels?.[0]
        ? `${tool}:${labels[0]}`
        : tool;
  return buildRecentOperation({
    entityKind,
    action: actionFromTool(tool),
    tool,
    recordIds,
    labels,
    summary,
  });
}

export function buildRecentOperationFromListedIds(input: {
  entityKind: RecentOperationEntityKind;
  tool: string;
  recordIds: string[];
  labels?: string[];
}): RecentOperationContext | null {
  return buildRecentOperation({
    entityKind: input.entityKind,
    action: 'list',
    tool: input.tool,
    recordIds: input.recordIds,
    labels: input.labels,
  });
}

function lastOperationKind(
  entityKind: RecentOperationEntityKind
): LastWhatsappOperation['kind'] | null {
  if (
    entityKind === 'order' ||
    entityKind === 'sale' ||
    entityKind === 'purchase' ||
    entityKind === 'payment' ||
    entityKind === 'cash' ||
    entityKind === 'client'
  ) {
    return entityKind;
  }
  return null;
}

function focusPatchForRecent(
  recent: RecentOperationContext,
  previous?: ConversationFocusEntities | null
): ConversationFocusEntities {
  const focus: ConversationFocusEntities = { ...(previous ?? {}) };
  const id = recent.primaryId || recent.recordIds[0];
  const label = recent.labels?.[0];
  if (!id) return focus;
  switch (recent.entityKind) {
    case 'product':
    case 'stock':
      focus.product = { id, name: label || focus.product?.name, locked: true };
      if (recent.recordIds.length > 1) {
        focus.products = recent.recordIds.map((recordId, index) => ({
          id: recordId,
          name: recent.labels?.[index] || undefined,
          locked: true,
        }));
      }
      break;
    case 'client':
    case 'payment':
      focus.client = {
        id: recent.entityKind === 'client' ? id : focus.client?.id || id,
        name: label || focus.client?.name,
        locked: true,
      };
      break;
    case 'order':
      focus.order = {
        id,
        label: label || focus.order?.label,
        locked: true,
      };
      break;
    case 'purchase':
      focus.purchase = { id, label: label || focus.purchase?.label, locked: true };
      break;
    case 'sale':
      focus.sale = { id, label: label || focus.sale?.label, locked: true };
      break;
    case 'supplier':
      focus.supplier = { id, name: label || focus.supplier?.name, locked: true };
      break;
    case 'collaborator':
      focus.collaborator = { id, name: label || focus.collaborator?.name, locked: true };
      break;
    case 'cash':
      focus.cash = { id, name: label || focus.cash?.name, locked: true };
      break;
    default:
      break;
  }
  return focus;
}

function presentedPatchForRecent(
  recent: RecentOperationContext,
  previous?: LastPresentedEntities | null
): LastPresentedEntities {
  const presented: LastPresentedEntities = { ...(previous ?? {}) };
  const id = recent.primaryId || recent.recordIds[0];
  const label = recent.labels?.[0];
  if (!id) return presented;
  switch (recent.entityKind) {
    case 'product':
    case 'stock':
      presented.product = { id, name: label, label };
      break;
    case 'client':
    case 'payment':
      presented.client = { id, name: label, label };
      break;
    case 'order':
      presented.order = { id, number: label, label };
      break;
    case 'supplier':
      presented.supplier = { id, name: label, label };
      break;
    case 'collaborator':
      presented.collaborator = { id, name: label, label };
      break;
    default:
      break;
  }
  return presented;
}

/**
 * Patch de ConversationState tras un write o listado relevante.
 * Conserva foco previo no relacionado; reemplaza recentOperation.
 * mode=list: solo IDs ordenados (sin enfocar el primer ítem).
 * mode=write: actualiza foco / presented / lastOperation cuando aplica.
 */
export function conversationPatchFromRecentOperation(
  recent: RecentOperationContext,
  previous?: ConversationState | null,
  opts?: { mode?: 'write' | 'list' }
): Partial<ConversationState> {
  const mode = opts?.mode ?? 'write';
  const listType = LIST_TYPE_BY_ENTITY[recent.entityKind];
  const listContext: ConversationListContext | null = listType
    ? {
        type: listType,
        items: (recent.labels?.length ? recent.labels : recent.recordIds).map(String),
        currentPage: 1,
        pageSize: recent.recordIds.length,
        totalResults: recent.recordIds.length,
        hasMore: false,
        offset: recent.recordIds.length,
        title: `Última operación · ${recent.entityKind}`,
      }
    : previous?.listContext ?? null;

  const base: Partial<ConversationState> = {
    recentOperation: recent,
    lastQueryResultIds: recent.recordIds,
    listContext,
    lastQuery: {
      intent: mode === 'list' ? `list_${recent.entityKind}` : `recent_${recent.entityKind}`,
      slots: {
        entity: recent.entityKind,
        metric: recent.action,
        limit: recent.recordIds.length,
      },
    },
  };

  if (mode === 'list') {
    return base;
  }

  const legacyKind = lastOperationKind(recent.entityKind);
  const lastOperation: LastWhatsappOperation | null = legacyKind
    ? {
        kind: legacyKind,
        id: recent.primaryId || recent.recordIds[0] || '',
        label: recent.labels?.[0],
        clientName:
          recent.entityKind === 'client' || recent.entityKind === 'payment'
            ? recent.labels?.[0]
            : previous?.lastOperation?.clientName,
        clientId: recent.entityKind === 'client' ? recent.primaryId || recent.recordIds[0] : undefined,
        productId:
          recent.entityKind === 'product' || recent.entityKind === 'stock'
            ? recent.primaryId || recent.recordIds[0]
            : undefined,
        productName:
          recent.entityKind === 'product' || recent.entityKind === 'stock'
            ? recent.labels?.[0]
            : undefined,
        at: recent.at,
      }
    : previous?.lastOperation ?? null;

  return {
    pendingIntent: null,
    pendingPayload: null,
    pendingPrompt: null,
    activeTask: null,
    operationPlan: null,
    lastPresentedConfirmation: null,
    ...base,
    focusEntities: focusPatchForRecent(recent, previous?.focusEntities),
    lastPresentedEntities: presentedPatchForRecent(recent, previous?.lastPresentedEntities),
    ...(lastOperation?.id
      ? { lastOperation, lastCompletedOperation: lastOperation }
      : {}),
  };
}

export function formatRecentOperationForAgent(
  recent: RecentOperationContext | null | undefined
): string {
  if (!isRecentOperationFresh(recent)) return 'recentOperation=none';
  const ordered = recent.recordIds
    .map((id, index) => {
      const label = recent.labels?.[index];
      return `${index + 1}:${id}${label ? `(${label})` : ''}`;
    })
    .join(',');
  return [
    `recentOperation=entity:${recent.entityKind}`,
    `action:${recent.action}`,
    recent.tool ? `tool:${recent.tool}` : null,
    `count:${recent.recordIds.length}`,
    `orderedIds=${ordered}`,
    `expiresAt=${recent.expiresAt}`,
  ]
    .filter(Boolean)
    .join(' ');
}

function normalizeLookupKey(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿La query de un find/list parece referirse al conjunto recentOperation
 * (mismo prefijo / overlap), sin interpretar frases en español?
 */
export function lookupQueryOverlapsRecentOperation(
  query: string,
  recent: RecentOperationContext | null | undefined
): boolean {
  if (!isRecentOperationFresh(recent)) return false;
  const q = normalizeLookupKey(query);
  if (q.length < 3) return false;
  const labels = (recent.labels ?? []).map(normalizeLookupKey).filter((row) => row.length >= 3);
  if (!labels.length) return false;
  if (labels.some((label) => label.includes(q) || q.includes(label))) return true;
  const qTokens = new Set(q.split(' ').filter((t) => t.length > 2));
  if (!qTokens.size) return false;
  return labels.some((label) => {
    const tokens = label.split(' ').filter((t) => t.length > 2);
    let hit = 0;
    for (const token of tokens) {
      if (qTokens.has(token)) hit += 1;
    }
    return hit >= Math.min(2, qTokens.size);
  });
}

/** entityKind de recent alineado a un tool find_* o list_*. */
export function recentEntityMatchesLookupTool(
  toolName: string,
  recent: RecentOperationContext | null | undefined
): boolean {
  if (!isRecentOperationFresh(recent)) return false;
  const t = toolName.toLowerCase();
  if (t.includes('product') || t.includes('stock') || t === 'list_recent_operation_records') {
    return recent.entityKind === 'product' || recent.entityKind === 'stock';
  }
  if (t.includes('client')) return recent.entityKind === 'client' || recent.entityKind === 'payment';
  if (t.includes('order')) return recent.entityKind === 'order' || recent.entityKind === 'payment';
  if (t.includes('supplier')) return recent.entityKind === 'supplier';
  if (t.includes('collaborator')) return recent.entityKind === 'collaborator';
  return false;
}

/**
 * Si recentOperation no está fresco, intenta reconstruir desde lastQueryResultIds /
 * focusEntities (mismo turno post-write a veces guardó IDs ahí aunque recent falló).
 */
export function recoverRecentOperationFromState(
  state: ConversationState | null | undefined
): RecentOperationContext | null {
  const fresh = getFreshRecentOperation(state);
  if (fresh) return fresh;

  const ids = Array.isArray(state?.lastQueryResultIds)
    ? state!.lastQueryResultIds.map((id) => String(id ?? '').trim()).filter(Boolean)
    : [];
  const focusProducts = state?.focusEntities?.products;
  const fromFocus =
    Array.isArray(focusProducts) && focusProducts.length
      ? focusProducts
          .map((row) => ({
            id: String(row?.id ?? '').trim(),
            name: String(row?.name ?? '').trim(),
          }))
          .filter((row) => row.id)
      : [];

  const recordIds = ids.length ? ids : fromFocus.map((row) => row.id);
  if (!recordIds.length) return null;

  const entityRaw = String(state?.lastQuery?.slots?.entity ?? '').trim().toLowerCase();
  const entityKind: RecentOperationEntityKind =
    entityRaw === 'client' ||
    entityRaw === 'order' ||
    entityRaw === 'supplier' ||
    entityRaw === 'collaborator' ||
    entityRaw === 'sale' ||
    entityRaw === 'purchase' ||
    entityRaw === 'cash' ||
    entityRaw === 'stock' ||
    entityRaw === 'product'
      ? (entityRaw as RecentOperationEntityKind)
      : fromFocus.length
        ? 'product'
        : 'other';

  const labelsFromList = Array.isArray(state?.listContext?.items)
    ? state!.listContext!.items.map((row) => String(row ?? '').trim()).filter(Boolean)
    : [];
  const labels =
    labelsFromList.length === recordIds.length
      ? labelsFromList
      : fromFocus.length === recordIds.length
        ? fromFocus.map((row) => row.name || row.id)
        : undefined;

  const action = String(state?.lastQuery?.slots?.metric ?? 'list').trim() || 'list';
  return buildRecentOperation({
    entityKind,
    action,
    tool: 'recovered_from_state',
    recordIds,
    labels,
    summary: `recovered:${entityKind}:${recordIds.length}`,
  });
}
