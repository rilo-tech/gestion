import type { AgentOperationPlan } from './agent/tool-types.ts';
import type { ConversationActiveTask, ConversationState } from './conversation-state.ts';
import { V4_CANDIDATE_SELECTION_PROMPT } from './v4-ui-copy.ts';
import { V4_CANDIDATE_SELECTION_INTENT } from './v4-candidate-selection.ts';
import { V4_CONFIRM_INTENT } from './v4-confirm.ts';
import {
  firstUnresolvedVisualIssue,
  isVisualDraftAlive,
  liveVisualDraft,
  parseVisualDraft,
  presentVisualDraftIssueReply,
  type VisualDocumentDraft,
} from './v4-visual-draft.ts';
import { formatWhatsappMessage } from '../../shared/whatsapp-format.ts';
import { parseAgentOperationPlan } from './agent/tools/write-tools.ts';

export const WORKFLOW_SUSPEND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WORKFLOW_CANCEL_NUMERIC = '0';
export const WORKFLOW_CANCEL_REPLY = 'Listo, cancelé esa operación.';

export type WorkflowType =
  | 'visual_purchase'
  | 'visual_order'
  | 'write_confirmation'
  | 'candidate_resolution'
  | 'generic';

export type WorkflowStatus =
  | 'active'
  | 'suspended'
  | 'awaiting_confirmation'
  | 'completed'
  | 'cancelled'
  | 'expired';

export type WorkflowSnapshot = {
  visualDraft?: VisualDocumentDraft | null;
  pendingIntent?: string | null;
  pendingPayload?: Record<string, unknown> | null;
  pendingPrompt?: string | null;
  activeTask?: ConversationActiveTask | null;
  operationPlan?: Record<string, unknown> | null;
};

export type WorkflowState = {
  workflowId: string;
  type: WorkflowType;
  status: WorkflowStatus;
  label: string;
  draftId?: string;
  planId?: string;
  operationType?: string;
  awaiting?: Record<string, unknown>;
  snapshot: WorkflowSnapshot;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};

export type LastPresentedConfirmation = {
  workflowId?: string;
  planId: string;
  presentedAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function newWorkflowId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function asTrimmed(value: unknown): string {
  return String(value ?? '').trim();
}

export function listWorkflows(state: ConversationState | null | undefined): WorkflowState[] {
  const rows = state?.v4Workflows;
  return Array.isArray(rows) ? rows.map((row) => ({ ...row, snapshot: { ...(row.snapshot ?? {}) } })) : [];
}

export function getWorkflowById(
  state: ConversationState | null | undefined,
  workflowId: string
): WorkflowState | null {
  const id = asTrimmed(workflowId);
  if (!id) return null;
  return listWorkflows(state).find((row) => row.workflowId === id) ?? null;
}

export function getActiveWorkflow(state: ConversationState | null | undefined): WorkflowState | null {
  const activeId = asTrimmed(state?.activeWorkflowId);
  if (activeId) {
    const row = getWorkflowById(state, activeId);
    if (row && row.status !== 'cancelled' && row.status !== 'expired' && row.status !== 'completed') {
      return row;
    }
  }
  return detectLegacyActiveWorkflow(state);
}

function detectLegacyActiveWorkflow(state: ConversationState | null | undefined): WorkflowState | null {
  if (!state) return null;
  if (hasBlockingConversationFields(state)) {
    return buildWorkflowFromConversationState(state, { status: inferActiveStatus(state) });
  }
  return null;
}

function inferActiveStatus(state: ConversationState): WorkflowStatus {
  if (state.pendingIntent === V4_CONFIRM_INTENT) return 'awaiting_confirmation';
  if (
    state.lastPresentedConfirmation?.planId &&
    (parseAgentOperationPlan(state.operationPlan) ||
      parseAgentOperationPlan((state.pendingPayload as { plan?: unknown } | null)?.plan))
  ) {
    return 'awaiting_confirmation';
  }
  return 'active';
}

export function hasBlockingConversationFields(state: ConversationState | null | undefined): boolean {
  if (!state) return false;
  if (liveVisualDraft(state)) return true;
  if (state.pendingIntent === V4_CONFIRM_INTENT) return true;
  if (state.pendingIntent === V4_CANDIDATE_SELECTION_INTENT) return true;
  // Plan congelado huérfano (pendingIntent perdido): sigue bloqueando hasta sí/no.
  if (
    state.lastPresentedConfirmation?.planId &&
    (parseAgentOperationPlan(state.operationPlan) ||
      parseAgentOperationPlan((state.pendingPayload as { plan?: unknown } | null)?.plan))
  ) {
    return true;
  }
  if (state.activeTask?.awaiting?.type === 'catalog_product_match_query') return true;
  if (state.activeTask?.awaiting?.type === 'unresolved_catalog_item') return true;
  if (state.activeTask?.intent === 'visual_draft_resolution') return true;
  return false;
}

export function hasCancellableActiveWorkflow(state: ConversationState | null | undefined): boolean {
  return hasBlockingConversationFields(state);
}

export function isExactWorkflowCancel(text: string): boolean {
  return asTrimmed(text) === WORKFLOW_CANCEL_NUMERIC;
}

export function inferWorkflowTypeFromState(state: ConversationState | null | undefined): WorkflowType {
  const draft = liveVisualDraft(state);
  if (draft?.kind === 'purchase') return 'visual_purchase';
  if (draft?.kind === 'order') return 'visual_order';
  if (state?.pendingIntent === V4_CONFIRM_INTENT) return 'write_confirmation';
  if (
    state?.lastPresentedConfirmation?.planId &&
    (parseAgentOperationPlan(state.operationPlan) ||
      parseAgentOperationPlan((state.pendingPayload as { plan?: unknown } | null)?.plan))
  ) {
    return 'write_confirmation';
  }
  if (state?.pendingIntent === V4_CANDIDATE_SELECTION_INTENT) return 'candidate_resolution';
  return 'generic';
}

export function buildWorkflowLabel(state: ConversationState | null | undefined): string {
  const draft = liveVisualDraft(state);
  if (draft?.kind === 'purchase') {
    const supplier = asTrimmed(draft.supplierName || draft.supplierHint) || 'Proveedor';
    return `Compra · ${supplier}`;
  }
  if (draft?.kind === 'order') {
    const client = asTrimmed(draft.clientName || draft.clientHint) || 'cliente';
    return `Pedido · ${client}`;
  }
  const plan = parseAgentOperationPlan(state?.operationPlan) ??
    parseAgentOperationPlan((state?.pendingPayload as { plan?: unknown } | null)?.plan);
  if (plan?.summary?.title) return String(plan.summary.title);
  if (state?.pendingPrompt) return asTrimmed(state.pendingPrompt);
  return 'Operación pendiente';
}

export function workflowCancelMenuLabel(state: ConversationState | null | undefined): string {
  const type = inferWorkflowTypeFromState(state);
  if (type === 'visual_purchase') return 'Cancelar compra';
  if (type === 'visual_order') return 'Cancelar pedido';
  if (type === 'write_confirmation') return 'Cancelar confirmación';
  return 'Cancelar operación';
}

export function captureSnapshotFromState(state: ConversationState | null | undefined): WorkflowSnapshot {
  if (!state) return {};
  const draft = parseVisualDraft(state.visualDraft);
  return {
    visualDraft: draft,
    pendingIntent: state.pendingIntent ?? null,
    pendingPayload: state.pendingPayload ?? null,
    pendingPrompt: state.pendingPrompt ?? null,
    activeTask: state.activeTask ?? null,
    operationPlan: state.operationPlan ?? null,
  };
}

export function applySnapshotToState(snapshot: WorkflowSnapshot): Partial<ConversationState> {
  return {
    visualDraft: snapshot.visualDraft ?? null,
    pendingIntent: snapshot.pendingIntent ?? null,
    pendingPayload: snapshot.pendingPayload ?? null,
    pendingPrompt: snapshot.pendingPrompt ?? null,
    activeTask: snapshot.activeTask ?? null,
    operationPlan: snapshot.operationPlan ?? null,
  };
}

export function clearBlockingConversationFields(): Partial<ConversationState> {
  return {
    visualDraft: null,
    pendingIntent: null,
    pendingPayload: null,
    pendingPrompt: null,
    activeTask: null,
    operationPlan: null,
  };
}

function cancelledVisualDraft(draft: VisualDocumentDraft | null | undefined): VisualDocumentDraft | null {
  if (!draft) return null;
  return { ...draft, status: 'cancelled' };
}

function upsertWorkflow(workflows: WorkflowState[], next: WorkflowState): WorkflowState[] {
  const idx = workflows.findIndex((row) => row.workflowId === next.workflowId);
  if (idx >= 0) {
    const copy = [...workflows];
    copy[idx] = next;
    return copy;
  }
  return [...workflows, next];
}

export function expireStaleWorkflows(
  workflows: WorkflowState[],
  now = Date.now()
): WorkflowState[] {
  return workflows.map((row) => {
    if (row.status !== 'suspended') return row;
    const expires = Date.parse(String(row.expiresAt ?? ''));
    if (!Number.isFinite(expires) || expires >= now) return row;
    return { ...row, status: 'expired', updatedAt: nowIso() };
  });
}

export function buildWorkflowFromConversationState(
  state: ConversationState,
  overrides?: Partial<WorkflowState>
): WorkflowState {
  const snapshot = captureSnapshotFromState(state);
  const draft = liveVisualDraft(state);
  const plan = parseAgentOperationPlan(state.operationPlan) ??
    parseAgentOperationPlan((state.pendingPayload as { plan?: unknown } | null)?.plan);
  const now = nowIso();
  return {
    workflowId: overrides?.workflowId ?? (asTrimmed(state.activeWorkflowId) || newWorkflowId()),
    type: overrides?.type ?? inferWorkflowTypeFromState(state),
    status: overrides?.status ?? inferActiveStatus(state),
    label: overrides?.label ?? buildWorkflowLabel(state),
    draftId: draft?.id ?? overrides?.draftId,
    planId: plan?.planId ?? overrides?.planId,
    operationType: plan?.writes?.[0]?.tool ?? overrides?.operationType,
    awaiting: (state.activeTask?.awaiting as Record<string, unknown> | undefined) ?? overrides?.awaiting,
    snapshot,
    createdAt: overrides?.createdAt ?? now,
    updatedAt: now,
    expiresAt: overrides?.expiresAt,
  };
}

export function syncActiveWorkflow(state: ConversationState | null | undefined): Partial<ConversationState> {
  if (!state || !hasBlockingConversationFields(state)) return {};
  const existing = getActiveWorkflow(state);
  const workflow = buildWorkflowFromConversationState(state, {
    workflowId: existing?.workflowId ?? (asTrimmed(state.activeWorkflowId) || newWorkflowId()),
    createdAt: existing?.createdAt,
    status: inferActiveStatus(state),
  });
  const workflows = expireStaleWorkflows(upsertWorkflow(listWorkflows(state), workflow));
  return {
    v4Workflows: workflows,
    activeWorkflowId: workflow.workflowId,
  };
}

export function suspendActiveWorkflow(state: ConversationState | null | undefined): Partial<ConversationState> {
  if (!state || !hasBlockingConversationFields(state)) {
    return { v4Workflows: expireStaleWorkflows(listWorkflows(state)) };
  }
  const syncPatch = syncActiveWorkflow(state);
  const mergedState = { ...state, ...syncPatch };
  const active = getActiveWorkflow(mergedState) ?? buildWorkflowFromConversationState(mergedState);
  const expiresAt = new Date(Date.now() + WORKFLOW_SUSPEND_TTL_MS).toISOString();
  const suspended: WorkflowState = {
    ...active,
    status: 'suspended',
    snapshot: captureSnapshotFromState(mergedState),
    updatedAt: nowIso(),
    expiresAt,
  };
  const workflows = expireStaleWorkflows(upsertWorkflow(listWorkflows(mergedState), suspended));
  return {
    ...clearBlockingConversationFields(),
    v4Workflows: workflows,
    activeWorkflowId: null,
  };
}

export function cancelActiveWorkflow(state: ConversationState | null | undefined): Partial<ConversationState> {
  if (!state || !hasBlockingConversationFields(state)) {
    return { v4Workflows: expireStaleWorkflows(listWorkflows(state)), activeWorkflowId: null };
  }
  const syncPatch = syncActiveWorkflow(state);
  const mergedState = { ...state, ...syncPatch };
  const active = getActiveWorkflow(mergedState) ?? buildWorkflowFromConversationState(mergedState);
  const snapshot = captureSnapshotFromState(mergedState);
  const cancelledDraft = cancelledVisualDraft(parseVisualDraft(snapshot.visualDraft));
  const cancelled: WorkflowState = {
    ...active,
    status: 'cancelled',
    snapshot: { ...snapshot, visualDraft: cancelledDraft },
    updatedAt: nowIso(),
  };
  const workflows = expireStaleWorkflows(upsertWorkflow(listWorkflows(mergedState), cancelled));
  return {
    ...clearBlockingConversationFields(),
    v4Workflows: workflows,
    activeWorkflowId: null,
    lastPresentedConfirmation: null,
  };
}

export function listSuspendedWorkflows(state: ConversationState | null | undefined): WorkflowState[] {
  return expireStaleWorkflows(listWorkflows(state)).filter((row) => row.status === 'suspended');
}

export const V4_WORKFLOW_RESUME_INTENT = 'awaiting:workflow_resume';

export type WorkflowResumeSelectionAwaiting = {
  type: 'workflow_resume_selection';
  options: Array<{ index: number; workflowId: string; label: string }>;
};

export function getWorkflowResumeSelectionAwaiting(
  state: ConversationState | null | undefined
): WorkflowResumeSelectionAwaiting | null {
  if (state?.pendingIntent !== V4_WORKFLOW_RESUME_INTENT) return null;
  const payload = state.pendingPayload?.workflowResumeSelection;
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as WorkflowResumeSelectionAwaiting;
  if (row.type !== 'workflow_resume_selection' || !Array.isArray(row.options) || row.options.length < 2) {
    return null;
  }
  return row;
}

export function buildWorkflowResumeSelectionState(workflows: WorkflowState[]): Partial<ConversationState> {
  const options = workflows.map((row, idx) => ({
    index: idx + 1,
    workflowId: row.workflowId,
    label: row.label,
  }));
  return {
    pendingIntent: V4_WORKFLOW_RESUME_INTENT,
    pendingPayload: {
      workflowResumeSelection: {
        type: 'workflow_resume_selection',
        options,
      },
    },
    pendingPrompt: V4_CANDIDATE_SELECTION_PROMPT,
    activeTask: null,
  };
}

export function resolveWorkflowResumeSelectionTurn(
  text: string,
  awaiting: WorkflowResumeSelectionAwaiting
): { kind: 'selected'; workflowId: string } | { kind: 'invalid'; max: number } | { kind: 'not_applicable' } {
  const raw = asTrimmed(text);
  if (!/^\d{1,2}$/.test(raw)) return { kind: 'not_applicable' };
  const index = Number(raw);
  const option = awaiting.options.find((row) => row.index === index);
  if (!option) return { kind: 'invalid', max: awaiting.options.length };
  return { kind: 'selected', workflowId: option.workflowId };
}

export function presentSuspendedWorkflowSelection(workflows: WorkflowState[]): string {
  const lines = workflows.map((row, idx) => `${idx + 1}. ${row.label}`);
  return formatWhatsappMessage({
    title: '¿Qué querés retomar?',
    lines,
    ask: V4_CANDIDATE_SELECTION_PROMPT,
  });
}

export function buildResumeWorkflowReply(state: ConversationState): string {
  const draft = liveVisualDraft(state);
  if (draft) {
    const issue = firstUnresolvedVisualIssue(draft);
    if (issue) {
      const lead =
        draft.kind === 'purchase'
          ? `Retomamos la compra de ${asTrimmed(draft.supplierName || draft.supplierHint) || 'proveedor'}.`
          : `Retomamos el pedido de ${asTrimmed(draft.clientName || draft.clientHint) || 'cliente'}.`;
      return `${formatWhatsappMessage({ title: lead.replace(/\.$/, ''), lines: [] })}\n\n${presentVisualDraftIssueReply(draft, issue)}`;
    }
    if (state.pendingIntent === V4_CONFIRM_INTENT && state.pendingPrompt) {
      return `Retomamos: ${asTrimmed(state.pendingPrompt)}`;
    }
  }
  if (state.pendingPrompt) return `Retomamos: ${asTrimmed(state.pendingPrompt)}`;
  return 'Retomamos la operación pendiente.';
}

export function resumeWorkflow(
  state: ConversationState | null | undefined,
  workflowId?: string
): { patch: Partial<ConversationState>; reply: string; intent: string } {
  const suspended = listSuspendedWorkflows(state);
  if (!suspended.length) {
    return {
      patch: {},
      reply: 'No tenía ninguna operación suspendida para retomar.',
      intent: 'v4_workflow_resume_missing',
    };
  }
  const targetId = asTrimmed(workflowId);
  let target: WorkflowState | undefined;
  if (targetId) {
    target = suspended.find((row) => row.workflowId === targetId);
  } else if (suspended.length === 1) {
    target = suspended[0];
  } else {
    return {
      patch: buildWorkflowResumeSelectionState(suspended),
      reply: presentSuspendedWorkflowSelection(suspended),
      intent: 'v4_workflow_resume_select',
    };
  }
  if (!target) {
    return {
      patch: {},
      reply: 'No encontré esa operación suspendida.',
      intent: 'v4_workflow_resume_not_found',
    };
  }
  const restored = applySnapshotToState(target.snapshot);
  const workflows = expireStaleWorkflows(
    listWorkflows(state).map((row) =>
      row.workflowId === target!.workflowId
        ? { ...row, status: inferActiveStatus({ ...state, ...restored } as ConversationState), updatedAt: nowIso() }
        : row
    )
  );
  const merged = { ...(state ?? {}), ...restored } as ConversationState;
  return {
    patch: {
      ...restored,
      v4Workflows: workflows,
      activeWorkflowId: target.workflowId,
    },
    reply: buildResumeWorkflowReply(merged),
    intent: 'v4_workflow_resumed',
  };
}

export function recordPresentedConfirmation(
  plan: AgentOperationPlan,
  workflowId?: string | null
): Partial<ConversationState> {
  const planId = asTrimmed(plan.planId);
  if (!planId) return {};
  return {
    lastPresentedConfirmation: {
      workflowId: asTrimmed(workflowId) || undefined,
      planId,
      presentedAt: nowIso(),
    },
  };
}

export function planMatchesPresentedConfirmation(
  state: ConversationState | null | undefined,
  plan: AgentOperationPlan | null | undefined
): boolean {
  if (!plan?.planId) return false;
  const presented = state?.lastPresentedConfirmation;
  if (!presented?.planId) return true;
  return presented.planId === plan.planId;
}

export function shouldAutoSuspendForAgent(
  state: ConversationState | null | undefined,
  text: string,
  opts?: { skipWhenVisualProductMatch?: boolean }
): boolean {
  if (!hasBlockingConversationFields(state)) return false;
  if (opts?.skipWhenVisualProductMatch) return false;
  if (isExactWorkflowCancel(text)) return false;
  return true;
}

export async function manageWorkflowAction(
  action: string,
  state: ConversationState | null | undefined,
  workflowId?: string
): Promise<{ patch: Partial<ConversationState>; reply: string; intent: string }> {
  const kind = asTrimmed(action).toLowerCase();
  if (kind === 'cancel') {
    return { patch: cancelActiveWorkflow(state), reply: WORKFLOW_CANCEL_REPLY, intent: 'v4_workflow_cancelled' };
  }
  if (kind === 'suspend') {
    return { patch: suspendActiveWorkflow(state), reply: 'Dejé esa operación en pausa.', intent: 'v4_workflow_suspended' };
  }
  if (kind === 'resume') {
    return resumeWorkflow(state, workflowId);
  }
  if (kind === 'list_suspended') {
    const suspended = listSuspendedWorkflows(state);
    return {
      patch: {},
      reply: suspended.length
        ? presentSuspendedWorkflowSelection(suspended)
        : 'No tenés operaciones suspendidas.',
      intent: suspended.length ? 'v4_workflow_resume_select' : 'v4_workflow_resume_missing',
    };
  }
  return { patch: {}, reply: 'Acción de workflow no reconocida.', intent: 'v4_workflow_invalid' };
}
