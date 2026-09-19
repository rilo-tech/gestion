import { db } from '../firebase.ts';
import { traceOrderItems } from './conversation-log.ts';
import type { VisualDocumentDraft } from './v4-visual-draft.ts';

export type LastWhatsappOperation = {
  kind: 'order' | 'sale' | 'purchase' | 'payment' | 'cash' | 'client';
  id: string;
  label?: string;
  clientName?: string;
  clientId?: string;
  status?: string;
  amount?: number;
  productId?: string;
  productName?: string;
  at: string;
};

/** El pedido del que se está hablando, aunque todavía no se haya guardado nada. */
export type WhatsappOrderFocus = {
  id: string;
  label?: string;
  clientName?: string;
  clientId?: string;
  status?: string;
  at: string;
};

export type ConversationFocusProduct = {
  id?: string;
  name?: string;
  locked?: boolean;
  attributes?: {
    type?: string | null;
    fabric?: string | null;
    model?: string | null;
    color?: string | null;
    size?: string | null;
    variant?: string | null;
  };
};

export type ConversationFocusEntities = {
  client?: { id?: string; name?: string; locked?: boolean };
  supplier?: { id?: string; name?: string; locked?: boolean };
  order?: { id?: string; label?: string; clientName?: string; status?: string; locked?: boolean };
  product?: ConversationFocusProduct;
  /** Ítems recientes/referenciables cuando el pedido tiene más de un producto. */
  products?: ConversationFocusProduct[];
  purchase?: { id?: string; label?: string; locked?: boolean };
  sale?: { id?: string; label?: string; locked?: boolean };
  cash?: { id?: string; name?: string; locked?: boolean };
  collaborator?: { id?: string; name?: string; locked?: boolean };
};

export type WhatsappChatTurn = {
  role: 'user' | 'bot';
  text: string;
  at: string;
};

export type ConversationActiveTask = {
  intent: string;
  collected?: Record<string, unknown>;
  awaiting?: {
    field?: string;
    type?: string;
    itemIndex?: number;
    draftId?: string;
    extractedDescription?: string;
    reason?: string;
    allowedActions?: string[];
  };
};

export type ConversationLastQuery = {
  intent: string;
  slots: {
    clientName?: string;
    productHint?: string;
    productId?: string;
    color?: string;
    size?: string;
    orderNumber?: string;
    targetOrderId?: string;
    targetOrderLabel?: string;
    cashAmbitoHint?: string;
    metric?: string;
    entity?: string;
    limit?: number;
    requestAll?: boolean;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    dateField?: string;
    sortDir?: string;
    offset?: number;
  };
};

export type ConversationListContext = {
  type: 'products' | 'clients' | 'orders' | 'options' | 'items' | 'stock';
  query?: string;
  items: string[];
  currentPage: number;
  pageSize: number;
  totalResults: number;
  filters?: ConversationLastQuery['slots'];
  wantAll?: boolean;
  title?: string;
  offset?: number;
  hasMore?: boolean;
  clientId?: string;
};

export interface ConversationState {
  businessId: string;
  phone: string;
  pendingIntent?: string | null;
  pendingPayload?: Record<string, unknown> | null;
  /** Última pregunta que hicimos, para retomarla si el dueño se va de tema. */
  pendingPrompt?: string | null;
  /** Tarea activa unificada (todas las acciones usan el mismo estado). */
  activeTask?: ConversationActiveTask | null;
  /** Última consulta, para «y Pedro?» / «y L?». */
  lastQuery?: ConversationLastQuery | null;
  /** Listado paginado (productos, pedidos, stock…). */
  listContext?: ConversationListContext | null;
  /** Última operación guardada, para preguntas («¿en qué estado lo registraste?»). */
  lastOperation?: LastWhatsappOperation | null;
  /** Alias explícito del último write completado (mismo valor que lastOperation). */
  lastCompletedOperation?: LastWhatsappOperation | null;
  /**
   * El pedido que se está mirando en el chat. Va aparte de lastOperation porque
   * «marcalo listo» habla del pedido que se está viendo, no del último que se guardó.
   */
  focusOrder?: WhatsappOrderFocus | null;
  /** Últimos turnos del chat, para que Gemini lea el hilo como una conversación. */
  turns?: WhatsappChatTurn[] | null;
  queuedTasks?: Array<{ intent: string; entities?: Record<string, unknown>; raw?: string }> | null;
  /** Plan inmutable a ejecutar si el dueño confirma. No se reinterpreta el mensaje. */
  operationPlan?: Record<string, unknown> | null;
  /** Entidades confirmadas (cliente, pedido, producto) para no saltar de foco. */
  focusEntities?: ConversationFocusEntities | null;
  /** Última entidad presentada al usuario (detalle o selección), con IDs reales. */
  lastPresentedEntities?: import('./v4-conversation-context.ts').LastPresentedEntities | null;
  /** Resultados estructurados de tools READ del último turno del Agent. */
  lastToolResults?: import('./v4-conversation-context.ts').LastToolResults | null;
  /** IDs del último listado mostrado (p. ej. pedidos numerados). */
  lastQueryResultIds?: string[] | null;
  /**
   * Última operación / conjunto de registros referenciables (IDs ordenados + TTL).
   * Sirve para follow-ups («listamelos», «el tercero», «los que modifiqué») sin re-buscar.
   */
  recentOperation?: import('./v4-recent-operation.ts').RecentOperationContext | null;
  /**
   * Borrador temporal de compra/pedido extraído de imagen.
   * No es una operación ERP hasta confirmar (`status=executed`).
   */
  visualDraft?: VisualDocumentDraft | null;
  /** Tarea que quedó en pausa al preguntar si seguimos (el foco no se borra). */
  suspendedTask?: ConversationActiveTask | null;
  /** Última actividad del hilo. Distinto de un pending eterno. */
  lastActiveAt?: string;
  /** Configuración inicial (caja/productos/proveedores) ofrecida al arrancar. */
  setupStatus?: 'offered' | 'done' | null;
  /** Workflows V4 (activos, suspendidos, cancelados). */
  v4Workflows?: import('./v4-workflow-manager.ts').WorkflowState[] | null;
  /** Workflow interactivo actual (resolución de draft, confirmación, etc.). */
  activeWorkflowId?: string | null;
  /** Último OperationPlan mostrado al usuario para confirmación exacta Sí/No. */
  lastPresentedConfirmation?: import('./v4-workflow-manager.ts').LastPresentedConfirmation | null;
  updatedAt: string;
}

/** Suelta pedido en foco y hilo, pero deja lastOperation. Para “empezamos de nuevo”. */
export async function dropConversationContext(
  businessId: string,
  phone: string
): Promise<void> {
  await saveConversationState(businessId, phone, {
    pendingIntent: null,
    pendingPayload: null,
    pendingPrompt: null,
    activeTask: null,
    lastQuery: null,
    listContext: null,
    lastQueryResultIds: null,
    recentOperation: null,
    queuedTasks: null,
    operationPlan: null,
    visualDraft: null,
    focusOrder: null,
    focusEntities: null,
    turns: [],
  });
}

function stateRef(businessId: string, phone: string) {
  const key = phone.replace(/[^0-9+]/g, '');
  return db.collection(`negocios/${businessId}/whatsapp_conversations`).doc(key);
}

export async function getConversationState(
  businessId: string,
  phone: string
): Promise<ConversationState | null> {
  const snap = await stateRef(businessId, phone).get();
  if (!snap.exists) return null;
  return snap.data() as ConversationState;
}

function omitUndefined(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(omitUndefined).filter((item) => item !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) continue;
    out[key] = omitUndefined(nested);
  }
  return out;
}

export async function saveConversationState(
  businessId: string,
  phone: string,
  patch: Partial<ConversationState>
): Promise<ConversationState> {
  const now = new Date().toISOString();
  const ref = stateRef(businessId, phone);
  const base = omitUndefined({
    businessId,
    phone,
    updatedAt: now,
    lastActiveAt: now,
    ...patch,
  }) as Record<string, unknown>;
  await ref.set(base, { merge: true });
  const payloadItems = (patch.pendingPayload as { entities?: { items?: unknown[] } } | undefined)?.entities
    ?.items;
  if (Array.isArray(payloadItems)) {
    traceOrderItems('conversationState', payloadItems as Array<Record<string, unknown>>);
  }
  const snap = await ref.get();
  return snap.data() as ConversationState;
}

export async function clearConversationState(businessId: string, phone: string): Promise<void> {
  const now = new Date().toISOString();
  await stateRef(businessId, phone).set(
    {
      businessId,
      phone,
      pendingIntent: null,
      pendingPayload: null,
      pendingPrompt: null,
      activeTask: null,
      suspendedTask: null,
      operationPlan: null,
      visualDraft: null,
      updatedAt: now,
      lastActiveAt: now,
    },
    { merge: true }
  );
}

/** Cierra la tarea pendiente y conserva foco / lastOperation. */
export async function clearConversationTask(businessId: string, phone: string): Promise<void> {
  await clearConversationState(businessId, phone);
}

/**
 * Completar una operación cierra la TAREA, no el FOCO.
 * pending/activeTask/confirmación se limpian; lastOperation y focusEntities quedan.
 */
export function conversationFocusAfterOperation(
  operation: LastWhatsappOperation,
  previous?: Pick<ConversationState, 'focusOrder' | 'focusEntities'> | null
): Pick<
  ConversationState,
  | 'pendingIntent'
  | 'pendingPayload'
  | 'pendingPrompt'
  | 'activeTask'
  | 'operationPlan'
  | 'lastOperation'
  | 'focusOrder'
  | 'focusEntities'
> {
  const at = operation.at || new Date().toISOString();
  const focusEntities: ConversationFocusEntities = { ...(previous?.focusEntities ?? {}) };
  let focusOrder = previous?.focusOrder ?? null;
  const sameOrder =
    previous?.focusOrder?.id === operation.id || previous?.focusEntities?.order?.id === operation.id;

  if (operation.kind === 'order' && operation.id) {
    focusOrder = {
      id: operation.id,
      label: operation.label,
      clientName: operation.clientName,
      clientId: operation.clientId,
      status: operation.status,
      at,
    };
    focusEntities.order = {
      id: operation.id,
      label: operation.label,
      clientName: operation.clientName,
      status: operation.status,
      locked: true,
    };
    if (operation.clientName || operation.clientId) {
      focusEntities.client = {
        ...focusEntities.client,
        id: operation.clientId || focusEntities.client?.id,
        name: operation.clientName || focusEntities.client?.name,
        locked: true,
      };
    }
    if (operation.productId || operation.productName) {
      focusEntities.product = {
        ...focusEntities.product,
        id: operation.productId || focusEntities.product?.id,
        name: operation.productName || focusEntities.product?.name,
        locked: true,
      };
    } else if (!sameOrder) {
      focusEntities.product = undefined;
      focusEntities.products = undefined;
    }
  } else if (operation.kind === 'client' && operation.id) {
    focusEntities.client = {
      id: operation.id,
      name: operation.clientName,
      locked: true,
    };
  } else if (operation.kind === 'purchase' && operation.id) {
    focusEntities.purchase = {
      id: operation.id,
      label: operation.label,
      locked: true,
    };
  } else if (operation.kind === 'sale' && operation.id) {
    focusEntities.sale = {
      id: operation.id,
      label: operation.label,
      locked: true,
    };
  }

  return {
    pendingIntent: null,
    pendingPayload: null,
    pendingPrompt: null,
    activeTask: null,
    operationPlan: null,
    lastOperation: operation,
    lastCompletedOperation: operation,
    focusOrder,
    focusEntities,
  };
}

export async function rememberLastOperation(
  businessId: string,
  phone: string,
  operation: LastWhatsappOperation
): Promise<void> {
  const prev = await getConversationState(businessId, phone);
  await saveConversationState(businessId, phone, conversationFocusAfterOperation(operation, prev));
}

export function activeTaskFromPending(input: {
  pendingIntent?: string | null;
  pendingPayload?: Record<string, unknown> | null;
}): ConversationActiveTask | null {
  const pending = String(input.pendingIntent ?? '').trim();
  if (!pending) return null;
  const payload = input.pendingPayload ?? {};
  const original = String(payload.originalIntent ?? pending.replace(/^confirm:/, '')).trim();
  const field = String(payload.missingField ?? '').trim() || undefined;
  const entities = (payload.entities ?? payload) as Record<string, unknown>;
  return {
    intent: original || pending,
    collected: {
      client: entities.clientName,
      amount: entities.amount,
      product: entities.productName,
    },
    awaiting: field ? { field, type: 'field', itemIndex: Number(payload.itemIndex) || undefined } : undefined,
  };
}

export async function rememberLastQuery(
  businessId: string,
  phone: string,
  lastQuery: ConversationLastQuery,
  listContext?: ConversationListContext | null
): Promise<void> {
  await saveConversationState(businessId, phone, {
    pendingIntent: null,
    pendingPayload: null,
    pendingPrompt: null,
    activeTask: null,
    lastQuery,
    listContext: listContext ?? null,
    setupStatus: 'done',
  });
}

export async function rememberFocusOrder(
  businessId: string,
  phone: string,
  order: { id: string; label?: string; clientName?: string; clientId?: string; status?: string },
  extra?: { product?: ConversationFocusProduct; products?: ConversationFocusProduct[] }
): Promise<void> {
  if (!order?.id) return;
  const prev = await getConversationState(businessId, phone);
  const at = new Date().toISOString();
  const focusOrder: WhatsappOrderFocus = {
    id: order.id,
    label: order.label,
    clientName: order.clientName,
    clientId: order.clientId,
    status: order.status,
    at,
  };
  const products = extra?.products?.filter((row) => row.id || row.name);
  const unique =
    extra?.product ||
    (products?.length === 1 ? products[0] : undefined) ||
    (prev?.focusEntities?.order?.id === order.id ? prev?.focusEntities?.product : undefined);
  await saveConversationState(businessId, phone, {
    focusOrder,
    focusEntities: {
      ...(prev?.focusEntities ?? {}),
      order: {
        id: order.id,
        label: order.label,
        clientName: order.clientName,
        status: order.status,
        locked: true,
      },
      ...(unique ? { product: { ...unique, locked: true } } : {}),
      ...(products && products.length > 1 ? { products } : {}),
    },
  });
}

export async function rememberFocusProduct(
  businessId: string,
  phone: string,
  product: ConversationFocusProduct
): Promise<void> {
  if (!product?.id && !product?.name) return;
  const prev = await getConversationState(businessId, phone);
  await saveConversationState(businessId, phone, {
    focusEntities: {
      ...(prev?.focusEntities ?? {}),
      product: { ...product, locked: true },
    },
  });
}

const MAX_TURNS = 10;
const MAX_TURN_CHARS = 480;

export async function appendConversationTurns(
  businessId: string,
  phone: string,
  incoming: Array<{ role: 'user' | 'bot'; text: string }>
): Promise<void> {
  const rows = incoming
    .map((row) => ({
      role: row.role,
      text: String(row.text ?? '').trim().slice(0, MAX_TURN_CHARS),
      at: new Date().toISOString(),
    }))
    .filter((row) => row.text);
  if (!rows.length) return;
  const prev = (await getConversationState(businessId, phone))?.turns ?? [];
  await saveConversationState(businessId, phone, {
    turns: [...prev, ...rows].slice(-MAX_TURNS),
  });
}
