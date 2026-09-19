import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { buildCandidateSelectionState } from './v4-candidate-selection.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import type { AgentOperationPlan, ConversationAgent, ToolCallRequest } from './agent/tool-types.ts';
import {
  ingestVisualDocument,
  type VisualDocumentDraft,
  type VisualDraftDeps,
} from './v4-visual-draft.ts';
import {
  cancelActiveWorkflow,
  listSuspendedWorkflows,
  manageWorkflowAction,
  recordPresentedConfirmation,
  resumeWorkflow,
  suspendActiveWorkflow,
  planMatchesPresentedConfirmation,
} from './v4-workflow-manager.ts';
import { V4_CONFIRM_INTENT } from './v4-confirm.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'rilo',
  phone: '+59899111111',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

function emptyState(extra?: Partial<ConversationState>): ConversationState {
  return {
    businessId: tenant.businessId,
    phone: tenant.phone,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

const visualDeps: VisualDraftDeps = {
  findProduct: async (_businessId, query) => {
    const q = String(query ?? '').toLowerCase();
    if (q.includes('gorra')) return { status: 'not_found', query };
    return { status: 'resolved', entity: { id: 'prod-x', name: 'Producto X' }, query };
  },
  findSupplier: async () => ({
    status: 'resolved',
    entity: { id: 'sup-disershop', name: 'Disershop' },
    query: 'Disershop',
  }),
};

const noopPersist = {
  rememberOp: async () => {},
  clearState: async () => {},
  saveState: async (_b: string, _p: string, patch: Partial<ConversationState>) =>
    ({
      businessId: tenant.businessId,
      phone: tenant.phone,
      updatedAt: new Date().toISOString(),
      ...patch,
    }) as ConversationState,
  appendTurns: async () => {},
  assertAi: async () => {},
};

describe('V4 workflow manager unit', () => {
  it('suspend preserves draft snapshot and clears blocking fields', async () => {
    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: 'Gorra roja', quantity: 2, unitCost: 400 }],
      },
      {
        tenant,
        state: null,
        messageId: 'wf-1',
        rawUserMessage: 'compra',
      },
      visualDeps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    const state = emptyState({ visualDraft: draft });
    const patch = suspendActiveWorkflow(state);
    assert.equal(patch.visualDraft, null);
    assert.equal(listSuspendedWorkflows({ ...state, ...patch }).length, 1);
    const suspended = listSuspendedWorkflows({ ...state, ...patch })[0]!;
    assert.equal(suspended.snapshot.visualDraft?.id, draft.id);
    assert.equal(suspended.snapshot.visualDraft?.supplierName, 'Disershop');
  });

  it('cancel marks workflow cancelled without ERP writes', () => {
    const state = emptyState({
      visualDraft: {
        id: 'vd_cancel',
        kind: 'purchase',
        status: 'awaiting_resolution',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        sourceMessageIds: [],
        supplierName: 'Disershop',
        items: [],
      },
    });
    const patch = cancelActiveWorkflow(state);
    assert.equal(patch.visualDraft, null);
    const cancelled = (patch.v4Workflows ?? []).find((row) => row.status === 'cancelled');
    assert.ok(cancelled);
    assert.equal(cancelled?.snapshot.visualDraft?.status, 'cancelled');
  });

  it('resume restores same draftId and unresolved item', async () => {
    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: 'Gorra roja', quantity: 2, unitCost: 400 }],
      },
      { tenant, state: null, messageId: 'wf-resume', rawUserMessage: 'compra' },
      visualDeps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    const suspendedState = emptyState({
      ...suspendActiveWorkflow(emptyState({ visualDraft: draft })),
    });
    const resumed = resumeWorkflow(suspendedState);
    const restored = resumed.patch.visualDraft as VisualDocumentDraft;
    assert.equal(restored.id, draft.id);
    assert.equal(restored.items[0]?.matchStatus, 'not_found');
    assert.match(resumed.reply, /Disershop/i);
  });

  it('lastPresentedConfirmation gates stale sí execution', () => {
    const planA = buildAgentOperationPlan(
      [{ tool: 'create_purchase', label: 'Compra A', args: { supplierId: 's1' } }],
      'compra a',
      'plan-a'
    );
    planA.planId = 'plan-a-id';
    const planB = buildAgentOperationPlan(
      [{ tool: 'register_cash_movement', label: 'Gasto', args: { amount: 500 } }],
      'gasto',
      'plan-b'
    );
    planB.planId = 'plan-b-id';
    const state = emptyState({
      ...recordPresentedConfirmation(planB),
      pendingIntent: V4_CONFIRM_INTENT,
      operationPlan: planA as unknown as Record<string, unknown>,
    });
    assert.equal(planMatchesPresentedConfirmation(state, planA), false);
    assert.equal(planMatchesPresentedConfirmation(state, planB), true);
  });
});

describe('V4 workflow turn routing', () => {
  async function purchaseAwaitingState() {
    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: 'Gorra roja', quantity: 2, unitCost: 400 }],
      },
      { tenant, state: null, messageId: 'turn-wf', rawUserMessage: 'compra' },
      visualDeps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    const awaiting = buildCandidateSelectionState({
      entityType: 'product',
      options: [
        { index: 1, entityId: '__visual_create__', label: 'Crear producto' },
        { index: 2, entityId: '__visual_free_line__', label: 'Sin catálogo' },
        { index: 3, entityId: '__visual_discard__', label: 'Descartar' },
        { index: 4, entityId: '__visual_link_existing__', label: 'Vincular' },
      ],
      resume: {
        originalUserText: 'compra',
        blockedTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 1,
        party: 'item',
      },
    });
    return emptyState({ ...awaiting, visualDraft: draft });
  }

  it('0 cancela workflow sin LLM ni writes ERP', async () => {
    let agentCalls = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '0', messageId: 'cancel-0' },
        text: '0',
        state: await purchaseAwaitingState(),
      },
      {
        ...noopPersist,
        createAgent: () => {
          agentCalls += 1;
          throw new Error('LLM should not run on workflow cancel 0');
        },
      }
    );
    assert.equal(agentCalls, 0);
    assert.equal(result.intent, 'v4_workflow_cancelled');
    assert.match(result.reply, /cancel/i);
  });

  it('consulta de caja durante not_found va al agent sin perder el PurchaseDraft', async () => {
    let agentCalls = 0;
    let saved: ConversationState = await purchaseAwaitingState();
    const draftId = String((saved.visualDraft as { id?: string } | null)?.id ?? '');
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '¿cuánto tengo en caja?', messageId: 'cash-mid' },
        text: '¿cuánto tengo en caja?',
        state: saved,
      },
      {
        ...noopPersist,
        saveState: async (_b, _p, patch) => {
          saved = { ...saved, ...patch };
          return saved;
        },
        createAgent: () =>
          ({
            runTurn: async (input) => {
              agentCalls += 1;
              assert.ok(input.state?.visualDraft, 'draft must stay active for same-turn agent');
              return {
                reply: '*Saldo de caja*\nCaja: $12.000',
                executed: false,
                intent: 'agent_v4',
                provider: 'mock',
                statePatch: { visualDraft: input.state?.visualDraft },
              };
            },
          }) as ConversationAgent,
      }
    );
    assert.equal(agentCalls, 1);
    assert.match(result.reply, /Saldo de caja/i);
    assert.equal(String((saved.visualDraft as { id?: string } | null)?.id ?? ''), draftId);
  });

  it('manage_workflow cancel vía agent tool cancela draft activo', async () => {
    const state = await purchaseAwaitingState();
    const result = await manageWorkflowAction('cancel', state);
    assert.equal(result.intent, 'v4_workflow_cancelled');
    assert.equal(result.patch.visualDraft, null);
    assert.ok((result.patch.v4Workflows ?? []).some((row) => row.status === 'cancelled'));
  });

  it('exact No invita a editar y mantiene el plan; cancelá limpia solo el plan', async () => {
    const draft = (await ingestVisualDocument(
      { kind: 'purchase', supplierHint: 'Disershop', items: [{ description: 'Gorra', quantity: 1, unitCost: 10 }] },
      { tenant, state: null, messageId: 'no-confirm', rawUserMessage: 'compra' },
      visualDeps
    )).draft as VisualDocumentDraft;
    const plan = buildAgentOperationPlan(
      [{ tool: 'create_purchase', label: 'Compra · Disershop', args: { supplierId: 'sup-disershop' } }],
      'compra',
      'plan-no'
    );
    let saved: ConversationState | null = null;
    const soft = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'no', messageId: 'confirm-no' },
        text: 'no',
        state: emptyState({
          pendingIntent: V4_CONFIRM_INTENT,
          pendingPayload: { plan },
          operationPlan: plan as unknown as Record<string, unknown>,
          visualDraft: { ...draft, status: 'awaiting_confirmation' },
        }),
      },
      {
        ...noopPersist,
        saveState: async (_b, _p, patch) => {
          saved = { businessId: tenant.businessId, phone: tenant.phone, updatedAt: new Date().toISOString(), ...patch } as ConversationState;
          return saved;
        },
        createAgent: () => {
          throw new Error('LLM should not run on exact no');
        },
      }
    );
    assert.equal(soft.intent, 'v4_confirm_edit');
    assert.equal(saved?.pendingIntent, V4_CONFIRM_INTENT);
    assert.ok(saved?.operationPlan);

    saved = null;
    const hard = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'cancelá', messageId: 'confirm-cancel' },
        text: 'cancelá',
        state: emptyState({
          pendingIntent: V4_CONFIRM_INTENT,
          pendingPayload: { plan },
          operationPlan: plan as unknown as Record<string, unknown>,
          visualDraft: { ...draft, status: 'awaiting_confirmation' },
        }),
      },
      {
        ...noopPersist,
        saveState: async (_b, _p, patch) => {
          saved = { businessId: tenant.businessId, phone: tenant.phone, updatedAt: new Date().toISOString(), ...patch } as ConversationState;
          return saved;
        },
        createAgent: () => {
          throw new Error('LLM should not run on cancelá');
        },
      }
    );
    assert.equal(hard.intent, 'v4_cancel');
    assert.equal(saved?.operationPlan, null);
    assert.ok(saved?.visualDraft);
    assert.equal(saved?.visualDraft?.status, 'awaiting_resolution');
  });
});
