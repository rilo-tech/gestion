import { randomUUID } from 'node:crypto';
import { db } from '../firebase.ts';
import { resolveOrderLabel, normalizeOrderReference } from '../utils/order-number.ts';
import {
  resolveFindOrderHintsForBusiness,
} from './resolve-order-reference.ts';
import type { ConversationState, LastWhatsappOperation } from './conversation-state.ts';
import type { AgentOperationPlan, ToolExecutionContext, ToolExecutionResult } from './agent/tool-types.ts';
import {
  buildRecentOperationFromListedIds,
  conversationPatchFromRecentOperation,
} from './v4-recent-operation.ts';

export type PresentedEntityRef = {
  id: string;
  number?: string;
  label?: string;
  name?: string;
};

export type LastPresentedEntities = {
  order?: PresentedEntityRef;
  client?: PresentedEntityRef;
  product?: PresentedEntityRef;
  supplier?: PresentedEntityRef;
  collaborator?: PresentedEntityRef;
};

export type LastToolResults = {
  get_order?: { orderId: string; number?: string };
  find_order?: { orderId?: string; number?: string; status?: string };
  list_orders?: { orderIds: string[] };
  find_client?: { clientId?: string; name?: string };
  find_product?: { productId?: string; name?: string };
  find_supplier?: { supplierId?: string; name?: string };
  find_collaborator?: { collaboratorId?: string; name?: string };
  get_collaborator?: { collaboratorId?: string; name?: string };
  list_collaborators?: { collaboratorIds: string[] };
};

export type V4TargetReference =
  | 'focused_order'
  | 'last_presented_order'
  | 'last_completed_order'
  | 'focused_client'
  | 'last_presented_client'
  | 'focused_product'
  | 'last_presented_product'
  | 'focused_supplier'
  | 'last_presented_supplier'
  | 'focused_collaborator'
  | 'last_presented_collaborator';

export type ResolvedOrderTarget = {
  orderId: string;
  label: string;
  clientName?: string;
  fromStatus?: string;
  source:
    | 'explicit_id'
    | 'explicit_number'
    | 'last_presented'
    | 'focus'
    | 'last_completed'
    | 'default_recency';
};

export type ResolvedCollaboratorTarget = {
  colaboradorId: string;
  name: string;
  source: 'explicit_id' | 'last_presented' | 'focus';
};

export type CollaboratorTargetHints = {
  collaboratorId?: string;
  query?: string;
  targetReference?: string;
};

export type OrderTargetHints = {
  orderId?: string;
  orderNumber?: string;
  query?: string;
  clientName?: string;
  targetReference?: string;
};

function presentedOrderFromRecord(
  id: string,
  data: Record<string, unknown>
): PresentedEntityRef {
  const number = resolveOrderLabel({
    numeroPedido: Number(data.numeroPedido) || undefined,
    numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
  });
  return { id, number, label: number };
}

export type OrderTargetLoader = (
  businessId: string,
  orderId: string
) => Promise<ResolvedOrderTarget | null>;

async function defaultLoadOrderById(
  businessId: string,
  orderId: string
): Promise<ResolvedOrderTarget | null> {
  const snap = await db.doc(`negocios/${businessId}/pedidos/${orderId}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  return {
    orderId,
    label: resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    }),
    clientName: String(data.clienteNombre ?? '').trim() || undefined,
    fromStatus: String(data.estado ?? '').trim() || undefined,
    source: 'explicit_id',
  };
}

function focusOrderId(state: ConversationState | null | undefined): string {
  return String(state?.focusOrder?.id ?? state?.focusEntities?.order?.id ?? '').trim();
}

function lastPresentedOrderId(state: ConversationState | null | undefined): string {
  return String(state?.lastPresentedEntities?.order?.id ?? '').trim();
}

function lastCompletedOrderId(state: ConversationState | null | undefined): string {
  const op = state?.lastCompletedOperation ?? state?.lastOperation;
  if (op?.kind === 'order' && op.id) return op.id;
  return '';
}

export function logV4ContextBefore(
  state: ConversationState | null | undefined,
  pendingPlan?: AgentOperationPlan | null
): void {
  const pendingTarget = pendingPlan?.writes?.find((row) => row.args.orderId)?.args.orderId ?? null;
  console.info(
    '[v4:context:before]',
    JSON.stringify({
      focusedOrder: focusOrderId(state) || null,
      lastPresentedOrder: lastPresentedOrderId(state) || null,
      pendingPlanTarget: pendingTarget,
      pendingPlanId: pendingPlan?.planId ?? null,
      pendingPlanVersion: pendingPlan?.planVersion ?? null,
    })
  );
}

export function logV4TargetResolved(resolved: ResolvedOrderTarget): void {
  console.info(
    '[v4:target:resolved]',
    JSON.stringify({
      source: resolved.source,
      entityType: 'order',
      entityId: resolved.orderId,
      label: resolved.label,
    })
  );
}

export function logV4PlanSuperseded(oldPlanId: string | undefined, newPlan: AgentOperationPlan): void {
  console.info(
    '[v4:plan:superseded]',
    JSON.stringify({
      oldPlanId: oldPlanId ?? null,
      newPlanId: newPlan.planId,
      newPlanVersion: newPlan.planVersion,
    })
  );
}

export function nextOperationPlanId(): string {
  return randomUUID();
}

export function supersedeOperationPlan(
  previous: AgentOperationPlan | null | undefined,
  next: AgentOperationPlan
): AgentOperationPlan {
  if (!previous?.planId) return next;
  logV4PlanSuperseded(previous.planId, next);
  return {
    ...next,
    supersedesPlanId: previous.planId,
    planVersion: (previous.planVersion ?? 1) + 1,
  };
}

function lastPresentedCollaboratorId(state: ConversationState | null | undefined): string {
  return String(state?.lastPresentedEntities?.collaborator?.id ?? '').trim();
}

function focusCollaboratorId(state: ConversationState | null | undefined): string {
  return String(state?.focusEntities?.collaborator?.id ?? '').trim();
}

export async function resolveCollaboratorTargetFromContext(
  ctx: ToolExecutionContext,
  hints: CollaboratorTargetHints
): Promise<ResolvedCollaboratorTarget> {
  const businessId = ctx.tenant.businessId;
  const state = ctx.state;
  const collaboratorId = String(hints.collaboratorId ?? '').trim();
  const targetReference = String(hints.targetReference ?? '').trim() as V4TargetReference | '';

  if (collaboratorId) {
    const snap = await db.doc(`negocios/${businessId}/colaboradores/${collaboratorId}`).get();
    if (!snap.exists) throw new Error('No encontré ese colaborador.');
    const data = snap.data() as { nombre?: string };
    const resolved = {
      colaboradorId: collaboratorId,
      name: String(data.nombre ?? '').trim(),
      source: 'explicit_id' as const,
    };
    console.info(
      '[v4:collaborator:resolved]',
      JSON.stringify({ source: resolved.source, colaboradorId: resolved.colaboradorId })
    );
    return resolved;
  }

  const resolveByReference = (ref: V4TargetReference): string => {
    if (ref === 'last_presented_collaborator') return lastPresentedCollaboratorId(state);
    if (ref === 'focused_collaborator') return focusCollaboratorId(state);
    return '';
  };

  if (targetReference) {
    const id = resolveByReference(targetReference);
    if (!id) throw new Error('No pude resolver el colaborador al que te referís.');
    const snap = await db.doc(`negocios/${businessId}/colaboradores/${id}`).get();
    if (!snap.exists) throw new Error('No encontré ese colaborador.');
    const resolved = {
      colaboradorId: id,
      name: String(snap.data()?.nombre ?? '').trim(),
      source: refToCollaboratorSource(targetReference),
    };
    console.info(
      '[v4:collaborator:resolved]',
      JSON.stringify({ source: resolved.source, colaboradorId: resolved.colaboradorId })
    );
    return resolved;
  }

  for (const ref of ['last_presented_collaborator', 'focused_collaborator'] as const) {
    const id = resolveByReference(ref);
    if (!id) continue;
    const snap = await db.doc(`negocios/${businessId}/colaboradores/${id}`).get();
    if (!snap.exists) continue;
    const resolved = {
      colaboradorId: id,
      name: String(snap.data()?.nombre ?? '').trim(),
      source: ref === 'last_presented_collaborator' ? ('last_presented' as const) : ('focus' as const),
    };
    console.info(
      '[v4:collaborator:resolved]',
      JSON.stringify({ source: resolved.source, colaboradorId: resolved.colaboradorId })
    );
    return resolved;
  }

  throw new Error('No encontré el colaborador. Decime el nombre.');
}

function refToCollaboratorSource(ref: V4TargetReference): ResolvedCollaboratorTarget['source'] {
  if (ref === 'last_presented_collaborator') return 'last_presented';
  if (ref === 'focused_collaborator') return 'focus';
  return 'explicit_id';
}

export function collaboratorFocusPatchFromPresented(
  collaborator: PresentedEntityRef,
  existing?: ConversationState | null
): Partial<ConversationState> {
  return {
    focusEntities: {
      ...(existing?.focusEntities ?? {}),
      collaborator: {
        id: collaborator.id,
        name: collaborator.name ?? collaborator.label,
        locked: true,
      },
    },
    lastPresentedEntities: {
      ...(existing?.lastPresentedEntities ?? {}),
      collaborator: {
        id: collaborator.id,
        name: collaborator.name ?? collaborator.label,
        label: collaborator.label ?? collaborator.name,
      },
    },
  };
}

export async function resolveOrderTargetFromContext(
  ctx: ToolExecutionContext,
  hints: OrderTargetHints,
  deps?: { loadOrder?: OrderTargetLoader }
): Promise<ResolvedOrderTarget> {
  const loadOrder = deps?.loadOrder ?? defaultLoadOrderById;
  const businessId = ctx.tenant.businessId;
  const state = ctx.state;
  const orderId = String(hints.orderId ?? '').trim();
  const orderNumber = String(hints.orderNumber ?? '').trim();
  const query = String(hints.query ?? '').trim();
  const targetReference = String(hints.targetReference ?? '').trim() as V4TargetReference | '';
  const explicitNumber = orderNumber || query;
  const hasExplicitNumber = Boolean(normalizeOrderReference(explicitNumber));
  const hasExplicitId = Boolean(orderId);

  if (hasExplicitId) {
    const loaded = await loadOrder(businessId, orderId);
    if (!loaded) throw new Error('No encontré ese pedido.');
    loaded.source = 'explicit_id';
    logV4TargetResolved(loaded);
    return loaded;
  }

  if (hasExplicitNumber) {
    const result = await resolveFindOrderHintsForBusiness(
      businessId,
      { orderNumber: explicitNumber, query: explicitNumber },
      ctx.rawUserMessage
    );
    if (result.status === 'resolved' && result.entity) {
      const resolved = await loadOrder(businessId, result.entity.id);
      if (!resolved) throw new Error('No encontré ese pedido.');
      resolved.source = 'explicit_number';
      logV4TargetResolved(resolved);
      return resolved;
    }
    if (result.status === 'ambiguous') {
      throw new Error('Encontré más de un pedido con esa referencia. Decime el número exacto.');
    }
    throw new Error(
      result.message ?? `No encontré el pedido #${normalizeOrderReference(explicitNumber)?.label ?? explicitNumber}.`
    );
  }

  const resolveByReference = async (
    ref: V4TargetReference
  ): Promise<ResolvedOrderTarget | null> => {
    if (ref === 'last_presented_order') {
      const id = lastPresentedOrderId(state);
      if (!id) return null;
      const loaded = await loadOrder(businessId, id);
      return loaded ? { ...loaded, source: 'last_presented' } : null;
    }
    if (ref === 'focused_order') {
      const id = focusOrderId(state);
      if (!id) return null;
      const loaded = await loadOrder(businessId, id);
      return loaded ? { ...loaded, source: 'focus' } : null;
    }
    if (ref === 'last_completed_order') {
      const id = lastCompletedOrderId(state);
      if (!id) return null;
      const loaded = await loadOrder(businessId, id);
      return loaded ? { ...loaded, source: 'last_completed' } : null;
    }
    return null;
  };

  if (targetReference) {
    const resolved = await resolveByReference(targetReference);
    if (!resolved) {
      throw new Error('No pude resolver el pedido al que te referís.');
    }
    logV4TargetResolved(resolved);
    return resolved;
  }

  // Recencia: last presented > focus > last completed (sin referencia explícita del Agent).
  for (const ref of ['last_presented_order', 'focused_order', 'last_completed_order'] as const) {
    const resolved = await resolveByReference(ref);
    if (resolved) {
      resolved.source = ref === 'last_presented_order' ? 'last_presented' : ref === 'focused_order' ? 'focus' : 'last_completed';
      logV4TargetResolved(resolved);
      return resolved;
    }
  }

  throw new Error('No encontré el pedido. Decime el número o el cliente.');
}

export function orderFocusPatchFromPresented(
  order: PresentedEntityRef,
  extra?: { clientId?: string; clientName?: string; status?: string },
  existing?: ConversationState | null
): Partial<ConversationState> {
  const at = new Date().toISOString();
  return {
    focusOrder: {
      id: order.id,
      label: order.label ?? order.number,
      clientName: extra?.clientName,
      clientId: extra?.clientId,
      status: extra?.status,
      at,
    },
    focusEntities: {
      ...(existing?.focusEntities ?? {}),
      order: {
        id: order.id,
        label: order.label ?? order.number,
        clientName: extra?.clientName,
        status: extra?.status,
        locked: true,
      },
    },
    lastPresentedEntities: {
      ...(existing?.lastPresentedEntities ?? {}),
      order: {
        id: order.id,
        number: order.number ?? order.label,
        label: order.label ?? order.number,
      },
    },
  };
}

export function buildContextPatchFromToolResults(
  results: ToolExecutionResult[],
  existing?: ConversationState | null
): Partial<ConversationState> {
  const patch: Partial<ConversationState> = {};
  const lastToolResults: LastToolResults = { ...(patch.lastToolResults as LastToolResults) };

  const findOrder = [...results].reverse().find(
    (row) => (row.name === 'find_order' || row.name === 'get_order') && row.ok
  );
  if (findOrder?.output.status === 'resolved') {
    const entity = (findOrder.output.entity ?? {}) as Record<string, unknown>;
    const id = String(entity.id ?? '').trim();
    if (id) {
      const number = String(entity.number ?? '');
      lastToolResults[findOrder.name === 'get_order' ? 'get_order' : 'find_order'] = {
        orderId: id,
        number,
        ...(findOrder.name === 'find_order' ? { status: 'resolved' } : {}),
      };
      const focusPatch = orderFocusPatchFromPresented(
        { id, number, label: number },
        {
          clientId: String(entity.clientId ?? ''),
          clientName: String(entity.clientName ?? ''),
          status: String(entity.status ?? ''),
        },
        existing
      );
      Object.assign(patch, focusPatch);
    }
  }

  const listOrders = results.find((row) => row.name === 'list_orders' && row.ok);
  if (listOrders && Array.isArray(listOrders.output.items)) {
    const items = listOrders.output.items as Array<{ id?: string; number?: string }>;
    const orderIds = items.map((row) => String(row.id ?? '')).filter(Boolean);
    if (orderIds.length) {
      lastToolResults.list_orders = { orderIds };
      patch.lastQueryResultIds = orderIds;
      const recent = buildRecentOperationFromListedIds({
        entityKind: 'order',
        tool: 'list_orders',
        recordIds: orderIds,
        labels: items.map((row) => String(row.number ?? row.id ?? '')),
      });
      if (recent) Object.assign(patch, conversationPatchFromRecentOperation(recent, existing, { mode: 'list' }));
    }
  }

  const listedRecords = results.find(
    (row) =>
      (row.name === 'list_products' || row.name === 'list_recent_operation_records') &&
      row.ok &&
      Array.isArray(row.output.items) &&
      (row.output.items as unknown[]).length > 0
  );
  if (listedRecords) {
    const items = listedRecords.output.items as Array<{ id?: string; name?: string; number?: string }>;
    const recordIds = items.map((row) => String(row.id ?? '')).filter(Boolean);
    const entityKindRaw = String(listedRecords.output.entityKind ?? '').trim();
    const entityKind =
      entityKindRaw === 'client' ||
      entityKindRaw === 'order' ||
      entityKindRaw === 'supplier' ||
      entityKindRaw === 'collaborator' ||
      entityKindRaw === 'product'
        ? entityKindRaw
        : listedRecords.name === 'list_products'
          ? 'product'
          : 'product';
    if (recordIds.length) {
      if (entityKind === 'product') {
        lastToolResults.find_product = {
          productId: recordIds[0],
          name: String(items[0]?.name ?? ''),
        };
      }
      const recent = buildRecentOperationFromListedIds({
        entityKind,
        tool: listedRecords.name,
        recordIds,
        labels: items.map((row) => String(row.name ?? row.number ?? row.id ?? '')),
      });
      if (recent) Object.assign(patch, conversationPatchFromRecentOperation(recent, existing, { mode: 'list' }));
    }
  }

  const findClient = [...results].reverse().find((row) => row.name === 'find_client' && row.ok);
  if (findClient?.output.status === 'resolved') {
    const entity = (findClient.output.entity ?? {}) as Record<string, unknown>;
    const id = String(entity.id ?? '').trim();
    const name = String(entity.name ?? '').trim();
    if (id) {
      lastToolResults.find_client = { clientId: id, name };
      patch.lastPresentedEntities = {
        ...(existing?.lastPresentedEntities ?? {}),
        ...(patch.lastPresentedEntities ?? {}),
        client: { id, name },
      };
    }
  }

  const findProduct = [...results].reverse().find((row) => row.name === 'find_product' && row.ok);
  if (findProduct?.output.status === 'resolved') {
    const entity = (findProduct.output.entity ?? {}) as Record<string, unknown>;
    const id = String(entity.id ?? '').trim();
    const name = String(entity.name ?? '').trim();
    if (id) {
      lastToolResults.find_product = { productId: id, name };
      patch.lastPresentedEntities = {
        ...(existing?.lastPresentedEntities ?? {}),
        ...(patch.lastPresentedEntities ?? {}),
        product: { id, name },
      };
      patch.focusEntities = {
        ...(existing?.focusEntities ?? {}),
        ...(patch.focusEntities ?? {}),
        product: { id, name, locked: true },
      };
    }
  }

  const findCollaborator = [...results].reverse().find(
    (row) => (row.name === 'find_collaborator' || row.name === 'get_collaborator') && row.ok
  );
  if (findCollaborator?.output.status === 'resolved') {
    const entity = (findCollaborator.output.entity ?? {}) as Record<string, unknown>;
    const id = String(entity.id ?? '').trim();
    const name = String(entity.name ?? '').trim();
    if (id) {
      lastToolResults[findCollaborator.name === 'get_collaborator' ? 'get_collaborator' : 'find_collaborator'] = {
        collaboratorId: id,
        name,
      };
      Object.assign(patch, collaboratorFocusPatchFromPresented({ id, name }, existing));
    }
  }

  const listCollaborators = results.find((row) => row.name === 'list_collaborators' && row.ok);
  if (listCollaborators && Array.isArray(listCollaborators.output.items)) {
    const items = listCollaborators.output.items as Array<{ id?: string }>;
    const collaboratorIds = items.map((row) => String(row.id ?? '')).filter(Boolean);
    if (collaboratorIds.length) {
      lastToolResults.list_collaborators = { collaboratorIds };
      patch.lastQueryResultIds = collaboratorIds;
    }
  }

  const cashRead = [...results].reverse().find(
    (row) =>
      (row.name === 'list_cash_movements' || row.name === 'get_cash_balance') &&
      row.ok &&
      row.output.status === 'resolved'
  );
  if (cashRead) {
    const cashAccountId = String(cashRead.output.cashAccountId ?? '').trim();
    const cashAccountName = String(cashRead.output.cashAccountName ?? '').trim();
    if (cashAccountId) {
      patch.focusEntities = {
        ...(existing?.focusEntities ?? {}),
        ...(patch.focusEntities ?? {}),
        cash: { id: cashAccountId, name: cashAccountName || cashAccountId, locked: true },
      };
    }
  }

  if (Object.keys(lastToolResults).length) {
    patch.lastToolResults = lastToolResults;
  }

  return patch;
}

export function pendingPlanFromState(state: ConversationState | null | undefined): AgentOperationPlan | null {
  if (!state?.operationPlan) return null;
  const plan = state.operationPlan as AgentOperationPlan;
  if (plan.version !== 'v4' || !Array.isArray(plan.writes)) return null;
  return plan;
}

export function planTargetOrderId(plan: AgentOperationPlan | null | undefined): string | null {
  const write = plan?.writes?.find((row) => row.args.orderId);
  return write ? String(write.args.orderId) : null;
}

export function extractOrderFromCompleted(op: LastWhatsappOperation | null | undefined): PresentedEntityRef | null {
  if (!op || op.kind !== 'order' || !op.id) return null;
  return { id: op.id, label: op.label, number: op.label };
}
