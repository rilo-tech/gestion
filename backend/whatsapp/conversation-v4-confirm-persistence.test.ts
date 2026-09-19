import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeWhatsappUtf8, formatWhatsappOutbound } from '../../shared/whatsapp-format.ts';
import {
  confirmationStatePatchFromPlan,
  freezeWriteCallsFromToolResults,
} from './agent/freeze-write-proposal.ts';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { V4_CONFIRM_INTENT } from './v4-confirm.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import type { AgentOperationPlan, ConversationAgent } from './agent/tool-types.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'rilo',
  phone: '+59899000001',
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

describe('sanitizeWhatsappUtf8', () => {
  it('repairs common UTF-8 mojibake', () => {
    assert.equal(sanitizeWhatsappUtf8('ConfirmÃ¡s'), 'Confirmás');
    assert.equal(sanitizeWhatsappUtf8('Â¿Confirmo?'), '¿Confirmo?');
  });

  it('strips replacement and zero-width characters', () => {
    assert.equal(sanitizeWhatsappUtf8('Hola\uFFFDmundo\u200B'), 'Holamundo');
  });

  it('formatWhatsappOutbound keeps accents', () => {
    const out = formatWhatsappOutbound('**Cambiar nombre**\n¿Confirmo? Sí / No');
    assert.match(out, /Cambiar nombre/);
    assert.match(out, /¿Confirmo\?/);
    assert.doesNotMatch(out, /Ã/);
  });
});

describe('freezeWriteCallsFromToolResults', () => {
  it('extracts freezeWrite proposals from read tools', () => {
    const calls = freezeWriteCallsFromToolResults([
      {
        toolCallId: '1',
        name: 'preview_rename_product',
        ok: true,
        output: {
          status: 'ready',
          freezeWrite: {
            tool: 'rename_products',
            args: { productIds: ['a', 'b'], newBaseName: 'Remera Polo Dry' },
          },
        },
      },
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, 'rename_products');
    assert.deepEqual(calls[0]?.arguments.productIds, ['a', 'b']);
  });
});

describe('V4 confirmation persistence', () => {
  const noopAi = {
    rememberOp: async () => {},
    clearState: async () => {},
    saveState: async (_b: string, _p: string, patch: Partial<ConversationState>) =>
      emptyState(patch),
    appendTurns: async () => {},
    assertAi: async () => {},
    tryOnboarding: async () => ({ kind: 'skip' as const }),
    verifyPlan: async (input: { reply: string; data: Record<string, unknown> }) => ({
      reply: input.reply,
      data: { ...input.data, persisted: input.data.persisted ?? true },
    }),
  };

  it('sí executes frozen rename plan from saved operationPlan', async () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'rename_products',
          label: 'Renombrar 2 productos',
          summaryTitle: 'Cambiar nombre de productos',
          summaryLines: ['• Remera Dry Negro S → Remera Polo Dry Negro S'],
          args: {
            productIds: ['p1', 'p2'],
            newBaseName: 'Remera Polo Dry',
            mode: 'base_name',
          },
        },
      ],
      'cambiales el nombre',
      'wa:rename-test'
    );
    const confirmPatch = confirmationStatePatchFromPlan(plan, emptyState(), '¿Confirmo? Sí / No');
    let executed = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí', messageId: 'yes-1' },
        text: 'sí',
        state: emptyState({
          ...confirmPatch,
          pendingIntent: V4_CONFIRM_INTENT,
          operationPlan: plan as unknown as Record<string, unknown>,
          lastPresentedConfirmation: {
            planId: plan.planId!,
            presentedAt: new Date().toISOString(),
          },
        }),
      },
      {
        ...noopAi,
        createAgent: () => {
          throw new Error('LLM should not run on exact sí');
        },
        executePlan: async (_tenant, frozen) => {
          executed += 1;
          assert.equal(frozen.writes[0]?.tool, 'rename_products');
          return { reply: 'Listo. Renombré *2* productos.', data: { kind: 'product_rename', count: 2 } };
        },
      }
    );
    assert.equal(executed, 1);
    assert.match(result.reply, /Listo/);
    assert.equal(result.executed, true);
  });

  it('sí recovers operationPlan even if pendingIntent was lost', async () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'rename_products',
          label: 'Renombrar',
          args: { productIds: ['p1'], newBaseName: 'X' },
        },
      ],
      'rename',
      'wa:rename-recover'
    );
    let executed = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí', messageId: 'yes-2' },
        text: 'sí',
        state: emptyState({
          pendingIntent: null,
          operationPlan: plan as unknown as Record<string, unknown>,
          lastPresentedConfirmation: {
            planId: plan.planId!,
            presentedAt: new Date().toISOString(),
          },
        }),
      },
      {
        ...noopAi,
        createAgent: () =>
          ({
            runTurn: async () => ({
              reply: 'No hay ninguna operación pendiente de confirmación.',
              intent: 'agent_v4',
              executed: false,
            }),
          }) as ConversationAgent,
        executePlan: async () => {
          executed += 1;
          return { reply: 'Listo. Renombré el producto.', data: { kind: 'product_rename' } };
        },
      }
    );
    assert.equal(executed, 1);
    assert.doesNotMatch(result.reply, /No hay ninguna operación pendiente/);
  });

  it('confirmationStatePatchFromPlan persists pendingIntent + operationPlan', () => {
    const plan = { version: 'v4', planId: 'plan-x', writes: [], summary: { title: 'T', lines: [] } } as AgentOperationPlan;
    const patch = confirmationStatePatchFromPlan(plan, emptyState(), '¿Confirmo?');
    assert.equal(patch.pendingIntent, V4_CONFIRM_INTENT);
    assert.ok(patch.operationPlan);
    assert.equal(patch.lastPresentedConfirmation?.planId, 'plan-x');
  });

  it('preview freezeWrite → patch → sí executes rename_products', async () => {
    const freezeCalls = freezeWriteCallsFromToolResults([
      {
        toolCallId: '1',
        name: 'preview_rename_product',
        ok: true,
        output: {
          status: 'ready',
          freezeWrite: {
            tool: 'rename_products',
            args: {
              productIds: ['p1', 'p2'],
              newBaseName: 'Remera Polo Dry',
              mode: 'base_name',
            },
          },
        },
      },
    ]);
    assert.equal(freezeCalls[0]?.name, 'rename_products');
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'rename_products',
          label: 'Renombrar 2 productos',
          args: freezeCalls[0]!.arguments,
        },
      ],
      'cambiales el nombre',
      'wa:freeze-chain'
    );
    const patch = confirmationStatePatchFromPlan(plan, emptyState(), '¿Confirmo? Sí / No');
    assert.equal(patch.pendingIntent, V4_CONFIRM_INTENT);
    let executed = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí', messageId: 'yes-3' },
        text: 'sí',
        state: emptyState(patch),
      },
      {
        ...noopAi,
        createAgent: () => {
          throw new Error('LLM should not run');
        },
        executePlan: async (_t, frozen) => {
          executed += 1;
          assert.deepEqual(frozen.writes[0]?.args.productIds, ['p1', 'p2']);
          return { reply: 'Listo. Renombré *2* productos.', data: { kind: 'product_rename', count: 2 } };
        },
      }
    );
    assert.equal(executed, 1);
    assert.equal(result.executed, true);
  });
});
