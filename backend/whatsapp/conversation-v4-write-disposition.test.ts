import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';
import { presentDirectExecuteReply } from './v4-auto-commit.ts';
import {
  classifyPreparedPlan,
  planAllowsAutoCommit,
  planNeedsConfirmation,
  writeToolDisposition,
} from './v4-write-disposition.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import type { ConversationAgent } from './agent/tool-types.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'rilo',
  phone: '+59899000099',
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

const noopAi = {
  rememberOp: async () => {},
  clearState: async () => {},
  saveState: async (_b: string, _p: string, patch: Partial<ConversationState>) => emptyState(patch),
  appendTurns: async () => {},
  assertAi: async () => {},
  tryOnboarding: async () => ({ kind: 'skip' as const }),
  verifyPlan: async (input: {
    reply: string;
    data: Record<string, unknown>;
  }) => ({
    reply: input.reply,
    data: { ...input.data, persisted: input.data.persisted ?? true },
  }),
};

describe('v4 write disposition', () => {
  it('EXECUTE_DIRECTLY for rename and descriptive writes', () => {
    assert.equal(writeToolDisposition('rename_products'), 'EXECUTE_DIRECTLY');
    assert.equal(writeToolDisposition('create_client'), 'EXECUTE_DIRECTLY');
    assert.equal(writeToolDisposition('update_client'), 'EXECUTE_DIRECTLY');
    assert.equal(writeToolDisposition('register_collaborator_hours'), 'EXECUTE_DIRECTLY');
  });

  it('NEEDS_CONFIRMATION for money, stock and orders', () => {
    assert.equal(writeToolDisposition('register_cash_movement'), 'NEEDS_CONFIRMATION');
    assert.equal(writeToolDisposition('register_order_payment'), 'NEEDS_CONFIRMATION');
    assert.equal(writeToolDisposition('collect_order_full_balance'), 'NEEDS_CONFIRMATION');
    assert.equal(writeToolDisposition('adjust_stock'), 'NEEDS_CONFIRMATION');
    assert.equal(writeToolDisposition('create_order'), 'NEEDS_CONFIRMATION');
    assert.equal(writeToolDisposition('register_collaborator_payment'), 'NEEDS_CONFIRMATION');
    assert.equal(writeToolDisposition('prepare_visual_draft_write'), 'NEEDS_CONFIRMATION');
  });

  it('unknown tools default to NEEDS_CONFIRMATION', () => {
    assert.equal(writeToolDisposition('delete_everything'), 'NEEDS_CONFIRMATION');
  });

  it('mixed plan with sensitive write needs confirmation', () => {
    const plan = buildAgentOperationPlan(
      [
        { tool: 'rename_products', label: 'r', args: {} },
        { tool: 'register_cash_movement', label: 'c', args: { amount: 1 } },
      ],
      'mix'
    );
    assert.equal(classifyPreparedPlan(plan), 'NEEDS_CONFIRMATION');
    assert.equal(planNeedsConfirmation(plan), true);
    assert.equal(planAllowsAutoCommit(plan), false);
  });

  it('rename-only plan is EXECUTE_DIRECTLY', () => {
    const plan = buildAgentOperationPlan(
      [{ tool: 'rename_products', label: 'r', args: { productIds: ['a'], newBaseName: 'X' } }],
      'rename'
    );
    assert.equal(classifyPreparedPlan(plan), 'EXECUTE_DIRECTLY');
    assert.equal(planAllowsAutoCommit(plan), true);
  });
});

describe('EXECUTE_DIRECTLY rename without sí', () => {
  it('handleV4 ejecuta rename_products al instante', async () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'rename_products',
          label: 'Renombrar 5',
          summaryTitle: 'Productos renombrados',
          summaryLines: ['• Remera Dry Negro L → Remera Polo Dry Negro L'],
          args: { productIds: ['p1', 'p2', 'p3', 'p4', 'p5'], newBaseName: 'Remera Polo Dry' },
        },
      ],
      'agregales Polo',
      'wa:direct-rename'
    );
    let executed = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'agregales Polo', messageId: 'direct-1' },
        text: 'agregales Polo',
        state: emptyState(),
      },
      {
        ...noopAi,
        createAgent: () =>
          ({
            runTurn: async () => ({
              reply: '',
              intent: 'v4_execute_direct',
              executed: false,
              operationPlan: plan,
            }),
          }) as ConversationAgent,
        executePlan: async (_t, frozen) => {
          executed += 1;
          assert.equal(frozen.writes[0]?.tool, 'rename_products');
          return {
            reply:
              'Listo. Renombré *5* productos.\n• Remera Dry Negro L → Remera Polo Dry Negro L',
            data: { kind: 'product_rename', count: 5 },
          };
        },
      }
    );
    assert.equal(executed, 1);
    assert.equal(result.executed, true);
    assert.match(result.reply, /Renombré/);
    assert.match(result.reply, /Si querés hacer algún otro cambio/);
    assert.doesNotMatch(result.reply, /¿Confirmo\?/);
    assert.doesNotMatch(result.reply, /se renombrarán/i);
  });

  it('auto-commit rename persiste recentOperation con IDs para el turno siguiente', async () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'rename_products',
          label: 'Renombrar 5',
          args: { productIds: ['p1', 'p2', 'p3', 'p4', 'p5'], newBaseName: 'Remera Polo Dry' },
        },
      ],
      'renombralos',
      'wa:recent-rename'
    );
    let savedRecent: ConversationState['recentOperation'] = null;
    let savedIds: string[] | null | undefined;
    await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'renombralos', messageId: 'recent-1' },
        text: 'renombralos',
        state: emptyState(),
      },
      {
        ...noopAi,
        saveState: async (_b, _p, patch) => {
          if (patch.recentOperation) savedRecent = patch.recentOperation;
          if (patch.lastQueryResultIds) savedIds = patch.lastQueryResultIds;
          return emptyState({ ...patch, recentOperation: patch.recentOperation ?? savedRecent });
        },
        createAgent: () =>
          ({
            runTurn: async () => ({
              reply: '',
              intent: 'v4_execute_direct',
              executed: false,
              operationPlan: plan,
            }),
          }) as ConversationAgent,
        executePlan: async () => ({
          reply: '✅ Listo, renombré los 5 productos:\n1. A\n2. B\n3. C\n4. D\n5. E',
          data: {
            kind: 'product',
            count: 5,
            productIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
            labels: ['A', 'B', 'C', 'D', 'E'],
            persisted: true,
          },
        }),
      }
    );
    assert.ok(savedRecent);
    assert.deepEqual(savedRecent!.recordIds, ['p1', 'p2', 'p3', 'p4', 'p5']);
    assert.equal(savedRecent!.action, 'rename');
    assert.deepEqual(savedIds, ['p1', 'p2', 'p3', 'p4', 'p5']);

    const { recoverRecentOperationFromState } = await import('./v4-recent-operation.ts');
    const recovered = recoverRecentOperationFromState(
      emptyState({ recentOperation: savedRecent, lastQueryResultIds: savedIds ?? null })
    );
    assert.ok(recovered);
    assert.equal(recovered!.recordIds[2], 'p3');
  });

  it('presentDirectExecuteReply usa pasado del executor', () => {
    const plan = buildAgentOperationPlan(
      [{ tool: 'rename_products', label: 'r', args: {} }],
      'x'
    );
    const text = presentDirectExecuteReply('Listo. Renombré *2* productos.', plan);
    assert.match(text, /Renombré/);
    assert.match(text, /Si querés hacer algún otro cambio/);
  });
});

describe('NEEDS_CONFIRMATION still freezes cash', () => {
  it('caja no auto-ejecuta; espera sí', async () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'register_cash_movement',
          label: 'Egreso $500',
          args: { type: 'egreso', amount: 500, concept: 'test' },
        },
      ],
      'sacar 500',
      'wa:cash-confirm'
    );
    let executed = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sacar 500', messageId: 'cash-1' },
        text: 'sacar 500',
        state: emptyState(),
      },
      {
        ...noopAi,
        createAgent: () =>
          ({
            runTurn: async () => ({
              reply: '¿Confirmo?\nSí / No',
              intent: 'confirm_v4',
              executed: false,
              operationPlan: plan,
              statePatch: {
                pendingIntent: 'confirm:v4_write',
                operationPlan: plan as unknown as Record<string, unknown>,
                lastPresentedConfirmation: {
                  planId: plan.planId!,
                  presentedAt: new Date().toISOString(),
                },
              },
            }),
          }) as ConversationAgent,
        executePlan: async () => {
          executed += 1;
          return { reply: 'Registrado', data: { kind: 'cash' } };
        },
      }
    );
    assert.equal(executed, 0);
    assert.equal(result.executed, false);
    assert.match(result.reply, /Confirmo/);
  });
});
