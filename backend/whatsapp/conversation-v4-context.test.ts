import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import type { AgentOperationPlan, ToolExecutionContext } from './agent/tool-types.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';
import {
  buildContextPatchFromToolResults,
  resolveOrderTargetFromContext,
  supersedeOperationPlan,
} from './v4-conversation-context.ts';
import {
  shouldCancelFrozenPlan,
  shouldExecuteFrozenPlan,
  shouldInviteConfirmEdit,
  shouldReinterpretPendingConfirm,
} from './v4-confirm.ts';
import { classifyConfirmReply } from './turn-interpreter.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'biz-a',
  phone: '+59899111111',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

const ORDER_A = { orderId: 'order-a', label: '00100', clientName: 'Cliente A' };
const ORDER_B = { orderId: 'order-b', label: '00200', clientName: 'Cliente B' };
const ORDER_C = { orderId: 'order-c', label: '00300', clientName: 'Cliente C' };

function mockLoader(orders: Record<string, { orderId: string; label: string; clientName?: string }>) {
  return async (_businessId: string, orderId: string) => {
    const row = orders[orderId];
    if (!row) return null;
    return { ...row, source: 'explicit_id' as const };
  };
}

function ctxWithState(state: ConversationState | null): ToolExecutionContext {
  return {
    tenant,
    state,
    messageId: 'msg-1',
    rawUserMessage: 'test',
  };
}

function stateWithOrders(focusId: string, presentedId: string): ConversationState {
  const focus = focusId === ORDER_A.orderId ? ORDER_A : focusId === ORDER_B.orderId ? ORDER_B : ORDER_C;
  const presented =
    presentedId === ORDER_A.orderId ? ORDER_A : presentedId === ORDER_B.orderId ? ORDER_B : ORDER_C;
  return {
    businessId: tenant.businessId,
    phone: tenant.phone,
    updatedAt: new Date().toISOString(),
    focusOrder: {
      id: focus.orderId,
      label: focus.label,
      clientName: focus.clientName,
      at: new Date().toISOString(),
    },
    focusEntities: {
      order: { id: focus.orderId, label: focus.label, locked: true },
    },
    lastPresentedEntities: {
      order: { id: presented.orderId, number: presented.label, label: presented.label },
    },
  };
}

function paymentPlan(orderId: string, label: string, amount: number, previous?: AgentOperationPlan | null): AgentOperationPlan {
  return buildAgentOperationPlan(
    [
      {
        tool: 'register_order_payment',
        label: `Cobrar $${amount} al pedido #${label}`,
        args: {
          businessId: tenant.businessId,
          orderId,
          amount,
        },
      },
    ],
    'cobrar',
    `wa:pay:${orderId}`,
    previous ?? null
  );
}

function pendingPaymentState(plan: AgentOperationPlan): ConversationState {
  return {
    ...stateWithOrders(ORDER_A.orderId, ORDER_B.orderId),
    pendingIntent: 'confirm:v4_write',
    pendingPayload: { plan },
    operationPlan: plan as unknown as Record<string, unknown>,
  };
}

const noopPersist = {
  rememberOp: async () => {},
  clearState: async () => {},
  saveState: async (_b: string, _p: string, patch: Partial<ConversationState>) =>
    ({ businessId: tenant.businessId, phone: tenant.phone, updatedAt: new Date().toISOString(), ...patch }) as ConversationState,
  appendTurns: async () => {},
  assertAi: async () => {},
};

describe('v4 context: lastPresented > stale focus', () => {
  it('targetReference last_presented_order resolves OrderB over stale focus OrderA', async () => {
    const state = stateWithOrders(ORDER_A.orderId, ORDER_B.orderId);
    const resolved = await resolveOrderTargetFromContext(
      ctxWithState(state),
      { targetReference: 'last_presented_order' },
      { loadOrder: mockLoader({ [ORDER_A.orderId]: ORDER_A, [ORDER_B.orderId]: ORDER_B }) }
    );
    assert.equal(resolved.orderId, ORDER_B.orderId);
    assert.equal(resolved.source, 'last_presented');
  });

  it('get_order tool result updates focus and lastPresented to OrderB', () => {
    const existing = stateWithOrders(ORDER_A.orderId, ORDER_A.orderId);
    const patch = buildContextPatchFromToolResults(
      [
        {
          name: 'get_order',
          ok: true,
          output: {
            status: 'resolved',
            entity: {
              id: ORDER_B.orderId,
              number: ORDER_B.label,
              clientName: ORDER_B.clientName,
            },
          },
        },
      ],
      existing
    );
    assert.equal(patch.focusOrder?.id, ORDER_B.orderId);
    assert.equal(patch.lastPresentedEntities?.order?.id, ORDER_B.orderId);
    assert.equal(patch.focusEntities?.client, undefined);
  });

  it('list_orders stores ids without silently focusing first item', () => {
    const patch = buildContextPatchFromToolResults([
      {
        name: 'list_orders',
        ok: true,
        output: {
          items: [{ id: ORDER_A.orderId }, { id: ORDER_B.orderId }, { id: ORDER_C.orderId }],
        },
      },
    ]);
    assert.deepEqual(patch.lastQueryResultIds, [ORDER_A.orderId, ORDER_B.orderId, ORDER_C.orderId]);
    assert.equal(patch.focusOrder, undefined);
    assert.equal(patch.lastPresentedEntities?.order, undefined);
  });
});

describe('v4 context: explicit target > context', () => {
  it('explicit orderId resolves C and never falls back to lastPresented B', async () => {
    const state = stateWithOrders(ORDER_A.orderId, ORDER_B.orderId);
    const resolved = await resolveOrderTargetFromContext(
      ctxWithState(state),
      { orderId: ORDER_C.orderId },
      { loadOrder: mockLoader({ [ORDER_C.orderId]: ORDER_C, [ORDER_B.orderId]: ORDER_B }) }
    );
    assert.equal(resolved.orderId, ORDER_C.orderId);
    assert.equal(resolved.source, 'explicit_id');
  });

  it('explicit reference that fails does not fall back to focus', async () => {
    const state = stateWithOrders(ORDER_A.orderId, ORDER_B.orderId);
    await assert.rejects(
      () =>
        resolveOrderTargetFromContext(
          ctxWithState(state),
          { orderId: 'missing-order' },
          { loadOrder: mockLoader({ [ORDER_A.orderId]: ORDER_A, [ORDER_B.orderId]: ORDER_B }) }
        ),
      /No encontré/
    );
  });
});

describe('v4 context: plan supersede on correction', () => {
  it('supersedes previous plan id and increments version', () => {
    const oldPlan = paymentPlan(ORDER_A.orderId, ORDER_A.label, 100);
    const newPlan = paymentPlan(ORDER_B.orderId, ORDER_B.label, 100, oldPlan);
    assert.notEqual(newPlan.planId, oldPlan.planId);
    assert.equal(newPlan.supersedesPlanId, oldPlan.planId);
    assert.equal(newPlan.planVersion, 2);
    assert.equal(newPlan.writes[0]?.args.orderId, ORDER_B.orderId);
    assert.equal(newPlan.writes[0]?.args.amount, 100);
  });

  it('supersedeOperationPlan preserves amount when only target changes', () => {
    const previous: AgentOperationPlan = {
      version: 'v4',
      planId: 'plan-old',
      planVersion: 1,
      writes: [{ tool: 'register_order_payment', label: 'x', args: { orderId: ORDER_A.orderId, amount: 1675 } }],
      summary: { title: 'x', lines: [] },
      rawUserMessage: 'pay',
    };
    const next: AgentOperationPlan = {
      version: 'v4',
      planId: 'plan-new',
      planVersion: 1,
      writes: [{ tool: 'register_order_payment', label: 'y', args: { orderId: ORDER_B.orderId, amount: 1675 } }],
      summary: { title: 'y', lines: [] },
      rawUserMessage: 'correct',
    };
    const merged = supersedeOperationPlan(previous, next);
    assert.equal(merged.supersedesPlanId, 'plan-old');
    assert.equal(merged.planVersion, 2);
    assert.equal(merged.writes[0]?.args.amount, 1675);
    assert.equal(merged.writes[0]?.args.orderId, ORDER_B.orderId);
  });
});

describe('v4 context: pending plan correction routing', () => {
  it('exact no invites edit without agent; cancelá cancels', () => {
    assert.equal(classifyConfirmReply('no'), 'cancel');
    assert.equal(shouldInviteConfirmEdit('confirm:v4_write', 'no'), true);
    assert.equal(shouldCancelFrozenPlan('confirm:v4_write', 'no'), false);
    assert.equal(shouldCancelFrozenPlan('confirm:v4_write', 'cancelá'), true);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', 'no'), false);
  });

  it('no + semantics routes to agent, not cancel', () => {
    assert.equal(classifyConfirmReply('No. Al pedido242'), 'correct');
    assert.equal(shouldReinterpretPendingConfirm('confirm:v4_write', 'No. Al pedido242'), true);
    assert.equal(shouldCancelFrozenPlan('confirm:v4_write', 'No. Al pedido242'), false);
    assert.equal(classifyConfirmReply('no, que sean 80'), 'correct');
  });

  it('correction turn calls agent and supersedes plan target', async () => {
    const oldPlan = paymentPlan(ORDER_A.orderId, ORDER_A.label, 100);
    let agentCalls = 0;
    let executeCalls = 0;
    let savedPlan: AgentOperationPlan | null = null;

    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'no, al pedido B', messageId: 'corr-pay' },
        text: 'no, al pedido B',
        state: pendingPaymentState(oldPlan),
      },
      {
        ...noopPersist,
        executePlan: async () => {
          executeCalls += 1;
          throw new Error('must not execute old plan');
        },
        saveState: async (_b, _p, patch) => {
          savedPlan = parsePlanFromPatch(patch);
          return { businessId: tenant.businessId, phone: tenant.phone, updatedAt: new Date().toISOString(), ...patch } as ConversationState;
        },
        createAgent: () => {
          agentCalls += 1;
          return {
            runTurn: async () => {
              const corrected = paymentPlan(ORDER_B.orderId, ORDER_B.label, 100, oldPlan);
              return {
                reply: `Cobrar $100 al pedido #${ORDER_B.label}\n¿Confirmo? Sí / No`,
                executed: false,
                intent: 'agent_v4',
                operationPlan: corrected,
                statePatch: {
                  pendingIntent: 'confirm:v4_write',
                  pendingPayload: { plan: corrected },
                  operationPlan: corrected as unknown as Record<string, unknown>,
                },
              };
            },
          };
        },
      }
    );

    assert.equal(agentCalls, 1);
    assert.equal(executeCalls, 0);
    assert.equal(savedPlan?.writes[0]?.args.orderId, ORDER_B.orderId);
    assert.equal(savedPlan?.supersedesPlanId, oldPlan.planId);
    assert.match(result.reply, /00200/);
  });

  it('si after correction executes only latest plan', async () => {
    const oldPlan = paymentPlan(ORDER_A.orderId, ORDER_A.label, 100);
    const newPlan = paymentPlan(ORDER_B.orderId, ORDER_B.label, 100, oldPlan);
    let executedOrderId = '';

    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'si', messageId: 'confirm-corrected' },
        text: 'si',
        state: pendingPaymentState(newPlan),
      },
      {
        ...noopPersist,
        createAgent: () => {
          throw new Error('LLM must not run on deterministic si');
        },
        executePlan: async (_t, plan) => {
          executedOrderId = String(plan.writes[0]?.args.orderId ?? '');
          return {
            reply: 'Listo.',
            data: { kind: 'payment', orderId: executedOrderId, amount: 100 },
          };
        },
      }
    );

    assert.equal(executedOrderId, ORDER_B.orderId);
    assert.equal(result.executed, true);
  });
});

function parsePlanFromPatch(patch: Partial<ConversationState>): AgentOperationPlan | null {
  const raw = patch.operationPlan ?? (patch.pendingPayload as { plan?: AgentOperationPlan } | undefined)?.plan;
  if (!raw || typeof raw !== 'object') return null;
  const plan = raw as AgentOperationPlan;
  if (plan.version !== 'v4' || !Array.isArray(plan.writes)) return null;
  return plan;
}
