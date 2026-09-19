import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';
import {
  isConfirmCorrection,
  isDeterministicNo,
  isDeterministicYes,
  shouldAutoExecuteAmendedConfirm,
  shouldCancelFrozenPlan,
  shouldExecuteFrozenPlan,
  shouldInviteConfirmEdit,
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
  verifyPlan: async (input: { reply: string; data: Record<string, unknown> }) => ({
    reply: input.reply,
    data: { ...input.data, persisted: input.data.persisted ?? true },
  }),
};

describe('RILO Bot v4 frozen confirm routing', () => {
  it('si / sí are deterministic yes', () => {
    assert.equal(isDeterministicYes('si'), true);
    assert.equal(isDeterministicYes('sí'), true);
    assert.equal(isDeterministicYes('1'), true);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', 'si'), true);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', '1'), true);
  });

  it('no invites edit; 0 and cancelá hard-cancel', () => {
    assert.equal(isDeterministicNo('no'), true);
    assert.equal(isDeterministicNo('0'), true);
    assert.equal(shouldInviteConfirmEdit('confirm:v4_write', 'no'), true);
    assert.equal(shouldCancelFrozenPlan('confirm:v4_write', 'no'), false);
    assert.equal(shouldCancelFrozenPlan('confirm:v4_write', '0'), true);
    assert.equal(shouldCancelFrozenPlan('confirm:v4_write', 'cancelá'), true);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', 'no'), false);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', '0'), false);
  });

  it('sí with extra text is confirm amendment (not bare correction)', () => {
    assert.equal(isConfirmCorrection('sí, pero ponelo pendiente'), false);
    assert.equal(shouldAutoExecuteAmendedConfirm('confirm:v4_write', 'sí, pero ponelo pendiente'), true);
    assert.equal(shouldReinterpretPendingConfirm('confirm:v4_write', 'sí, pero ponelo pendiente'), true);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', 'sí, pero ponelo pendiente'), false);
    assert.equal(shouldAutoExecuteAmendedConfirm('confirm:v4_write', 'sí y saldalo todo'), true);
    assert.equal(shouldAutoExecuteAmendedConfirm('confirm:v4_write', 'sí'), false);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', 'sí y saldalo todo'), false);
  });

  it('natural confirm phrases execute; ambiguous does not', () => {
    for (const phrase of ['dale', 'hacelo', 'correcto', 'confirmo', 'está bien', 'esta bien', 'perfecto', 'mandale']) {
      assert.equal(isDeterministicYes(phrase), true, phrase);
      assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', phrase), true, phrase);
    }
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', 'tal vez'), false);
    assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', 'no sé'), false);
    assert.equal(isConfirmCorrection('tal vez'), true);
  });

  it('natural cancel phrases cancel; bare no invites edit', () => {
    for (const phrase of ['no', 'nop', 'nah']) {
      assert.equal(isDeterministicNo(phrase), true, phrase);
      assert.equal(shouldInviteConfirmEdit('confirm:v4_write', phrase), true, phrase);
      assert.equal(shouldCancelFrozenPlan('confirm:v4_write', phrase), false, phrase);
      assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', phrase), false, phrase);
    }
    for (const phrase of ['dejalo', 'cancelá', 'cancela', 'mejor no', 'no lo hagas', '0']) {
      assert.equal(isDeterministicNo(phrase), true, phrase);
      assert.equal(shouldCancelFrozenPlan('confirm:v4_write', phrase), true, phrase);
      assert.equal(shouldInviteConfirmEdit('confirm:v4_write', phrase), false, phrase);
      assert.equal(shouldExecuteFrozenPlan('confirm:v4_write', phrase), false, phrase);
    }
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

  it('no invites edit without clearing the plan or calling LLM', async () => {
    const plan = frozenStatusPlan();
    let executeCalls = 0;
    let agentCalls = 0;
    let savedPatch: Partial<ConversationState> | null = null;
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
        saveState: async (_biz, _phone, patch) => {
          savedPatch = patch;
        },
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
    assert.equal(result.intent, 'v4_confirm_edit');
    assert.match(result.reply, /cambi/i);
    assert.equal(savedPatch?.pendingIntent, 'confirm:v4_write');
    assert.ok(savedPatch?.operationPlan);
  });

  it('cancelá clears the plan without LLM', async () => {
    const plan = frozenStatusPlan();
    let executeCalls = 0;
    let agentCalls = 0;
    let savedPatch: Partial<ConversationState> | null = null;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'cancelá', messageId: 'cancel-hard-1' },
        text: 'cancelá',
        state: pendingState(plan),
      },
      {
        ...noopPersist,
        saveState: async (_biz, _phone, patch) => {
          savedPatch = patch;
        },
        createAgent: () => {
          agentCalls += 1;
          throw new Error('LLM should not run on cancelá');
        },
        executePlan: async () => {
          executeCalls += 1;
          throw new Error('ERP should not run on cancelá');
        },
      }
    );
    assert.equal(agentCalls, 0);
    assert.equal(executeCalls, 0);
    assert.equal(result.executed, false);
    assert.equal(result.intent, 'v4_cancel');
    assert.match(result.reply, /cancelado/i);
    assert.equal(savedPatch?.pendingIntent, null);
    assert.equal(savedPatch?.operationPlan, null);
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
    let afterExecute = false;
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
        saveState: async (_b, _p, patch) => {
          if (afterExecute) throw new Error('firestore down');
          return {
            businessId: 'rilo',
            phone: '+59899111111',
            updatedAt: new Date().toISOString(),
            ...patch,
          } as ConversationState;
        },
        executePlan: async () => {
          executeCalls += 1;
          afterExecute = true;
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

  it('sí on status-only plan with saldo asks settle without another Confirmo', async () => {
    const plan = frozenStatusPlan();
    let saved: Record<string, unknown> | null = null;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí', messageId: 'confirm-settle-1' },
        text: 'sí',
        state: pendingState(plan),
      },
      {
        ...noopPersist,
        saveState: async (_b, _p, patch) => {
          saved = { ...(saved ?? {}), ...patch };
          return {
            businessId: 'rilo',
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            ...saved,
          } as ConversationState;
        },
        executePlan: async () => ({
          reply: 'Pedido actualizado ✅\nEstado: Entregado',
          data: {
            kind: 'order',
            orderId: 'order-x',
            label: '00229',
            status: 'entregado',
            clientName: 'Lucia',
            saldoRemaining: 970,
          },
        }),
        createAgent: () => {
          throw new Error('LLM should not run');
        },
      }
    );
    assert.equal(result.executed, true);
    assert.match(result.reply, /Entregado/);
    assert.match(result.reply, /Saldar todo/);
    assert.match(result.reply, /Dejar con saldo/);
    assert.doesNotMatch(result.reply, /¿Confirmo\?/);
    assert.equal(saved?.pendingIntent, 'awaiting:order_settle_choice');
  });

  it('sí y saldalo todo amends and executes without a second Confirmo', async () => {
    const plan = frozenStatusPlan();
    const amended = buildAgentOperationPlan(
      [
        ...plan.writes,
        {
          tool: 'collect_order_full_balance',
          label: 'Cobrar saldo',
          args: { orderId: 'order-x', payFullBalance: true },
        },
      ],
      'sí y saldalo todo'
    );
    let executeCalls = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'Si y saldalo todo', messageId: 'confirm-amend-1' },
        text: 'Si y saldalo todo',
        state: pendingState(plan),
      },
      {
        ...noopPersist,
        createAgent: () =>
          ({
            async runTurn() {
              return {
                reply: '¿Confirmo? Sí / No',
                executed: false,
                intent: 'confirm_v4',
                operationPlan: amended,
                provider: 'openai',
              };
            },
          }) as never,
        executePlan: async (_t, received) => {
          executeCalls += 1;
          assert.equal(received.writes.length, 2);
          assert.ok(received.writes.some((row) => row.tool === 'collect_order_full_balance'));
          return {
            reply: 'Pedido actualizado ✅\nCobré el saldo.',
            data: { kind: 'order', orderId: 'order-x', label: '00229', status: 'entregado', saldoRemaining: 0 },
          };
        },
      }
    );
    assert.equal(executeCalls, 1);
    assert.equal(result.executed, true);
    assert.doesNotMatch(result.reply, /¿Confirmo\?/);
    assert.match(result.reply, /Cobré el saldo|actualizado/i);
  });
});
