import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';
import {
  isConfirmCorrection,
  isDeterministicNo,
  isDeterministicYes,
  shouldCancelFrozenPlan,
  shouldExecuteFrozenPlan,
  shouldReinterpretPendingConfirm,
} from './v4-confirm.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';

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

function frozenStatusPlan(): AgentOperationPlan {
  return buildAgentOperationPlan(
    [
      {
        tool: 'update_order_status',
        label: 'Estado #00229 → entregado',
        args: {
          businessId: 'rilo',
          orderId: 'order-x',
          orderNumber: '00229',
          fromStatus: 'listo',
          status: 'entregado',
          requestedStatus: 'entregado',
          clientName: 'Pizzeria Acapella',
        },
      },
    ],
    'move el pedido 00229 a entregado',
    'wa:msg-status:update_order_status'
  );
}

function pendingState(plan: AgentOperationPlan): ConversationState {
  return {
    businessId: 'rilo',
    phone: '+59899111111',
    updatedAt: new Date().toISOString(),
    pendingIntent: 'confirm:v4_write',
    pendingPayload: { plan },
    operationPlan: plan as unknown as Record<string, unknown>,
    focusOrder: {
      id: 'order-x',
      label: '00229',
      clientName: 'Pizzeria Acapella',
      status: 'listo',
      at: new Date().toISOString(),
    },
  };
}

const noopPersist = {
  rememberOp: async () => {},
  clearState: async () => {},
  saveState: async (_b: string, _p: string, patch: Partial<ConversationState>) =>
    ({ businessId: 'rilo', phone: '+59899111111', updatedAt: new Date().toISOString(), ...patch }) as ConversationState,
  appendTurns: async () => {},
  assertAi: async () => {},
};

describe('RILO Bot v4 frozen confirm routing', () => {
  it('si / sí are deterministic yes', () => {
    assert.equal(isDeterministicYes('si'), true);
    assert.equal(isDeterministicYes('sí'), true);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', 'si'), true);
  });

  it('no cancels frozen plan', () => {
    assert.equal(isDeterministicNo('no'), true);
    assert.equal(shouldCancelFrozenPlan('confirm:v4_write', 'no'), true);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', 'no'), false);
  });

  it('sí, pero ponelo pendiente is a correction', () => {
    assert.equal(isConfirmCorrection('sí, pero ponelo pendiente'), true);
    assert.equal(shouldReinterpretPendingConfirm('confirm:v4_write', 'sí, pero ponelo pendiente'), true);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', 'sí, pero ponelo pendiente'), false);
  });
});

describe('RILO Bot v4 sí executes frozen plan without LLM', () => {
  it('sí runs executeFrozenPlan once and update_order_status once', async () => {
    const plan = frozenStatusPlan();
    let executeCalls = 0;
    let agentCalls = 0;
    let seenTenantId = '';
    let statusCommands = 0;

    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí', messageId: 'confirm-1' },
        text: 'sí',
        state: pendingState(plan),
      },
      {
        ...noopPersist,
        createAgent: () => {
          agentCalls += 1;
          throw new Error('LLM should not run on deterministic sí');
        },
        executePlan: async (receivedTenant, receivedPlan) => {
          executeCalls += 1;
          seenTenantId = receivedTenant.businessId;
          assert.equal(receivedPlan.writes[0]?.tool, 'update_order_status');
          assert.equal(receivedPlan.writes[0]?.args.orderId, 'order-x');
          statusCommands += 1;
          return {
            reply: '✅ Pedido #00229 marcado como Entregado.',
            data: {
              kind: 'order',
              orderId: 'order-x',
              label: '00229',
              status: 'entregado',
              clientName: 'Pizzeria Acapella',
            },
          };
        },
      }
    );

    assert.equal(agentCalls, 0);
    assert.equal(executeCalls, 1);
    assert.equal(statusCommands, 1);
    assert.equal(seenTenantId, 'rilo');
    assert.equal(result.executed, true);
    assert.match(result.reply, /Entregado/);
    assert.equal(result.intent, 'v4_execute');
  });

  it('no does not write ERP and does not call LLM', async () => {
    const plan = frozenStatusPlan();
    let executeCalls = 0;
    let agentCalls = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'no', messageId: 'cancel-1' },
        text: 'no',
        state: pendingState(plan),
      },
      {
        ...noopPersist,
        createAgent: () => {
          agentCalls += 1;
          throw new Error('LLM should not run on no');
        },
        executePlan: async () => {
          executeCalls += 1;
          throw new Error('ERP should not run on no');
        },
      }
    );
    assert.equal(agentCalls, 0);
    assert.equal(executeCalls, 0);
    assert.equal(result.executed, false);
    assert.equal(result.intent, 'v4_cancel');
  });

  it('sí, pero ponelo pendiente goes to the agent', async () => {
    const plan = frozenStatusPlan();
    let executeCalls = 0;
    let agentCalls = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí, pero ponelo pendiente', messageId: 'corr-1' },
        text: 'sí, pero ponelo pendiente',
        state: pendingState(plan),
      },
      {
        ...noopPersist,
        executePlan: async () => {
          executeCalls += 1;
          throw new Error('frozen plan must not run');
        },
        createAgent: () => {
          agentCalls += 1;
          return {
            runTurn: async () => ({
              reply: 'ok reinterpret',
              executed: false,
              intent: 'agent_v4',
            }),
          };
        },
      }
    );
    assert.equal(executeCalls, 0);
    assert.equal(agentCalls, 1);
    assert.equal(result.reply, 'ok reinterpret');
  });

  it('write ok + persist fail still reports executed and does not retry write', async () => {
    const plan = frozenStatusPlan();
    let executeCalls = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'si', messageId: 'persist-fail' },
        text: 'si',
        state: pendingState(plan),
      },
      {
        ...noopPersist,
        rememberOp: async () => {
          throw new Error('firestore down');
        },
        executePlan: async () => {
          executeCalls += 1;
          return {
            reply: '✅ Pedido #00229 marcado como Entregado.',
            data: { kind: 'order', orderId: 'order-x', label: '00229', status: 'entregado' },
          };
        },
        createAgent: () => {
          throw new Error('LLM should not run');
        },
      }
    );
    assert.equal(executeCalls, 1);
    assert.equal(result.executed, true);
    assert.equal(result.intent, 'v4_execute_persist_failed');
  });
});
