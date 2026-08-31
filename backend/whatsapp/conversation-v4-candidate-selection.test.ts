import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import {
  buildCandidateSelectionState,
  getCandidateSelectionAwaiting,
  isExactNumericOnly,
  parseNumericSelectionTurn,
  resolveCandidateSelectionTurn,
} from './v4-candidate-selection.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

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

function candidateState(): ConversationState {
  const awaiting = buildCandidateSelectionState({
    entityType: 'client',
    options: [
      { index: 1, entityId: 'a', label: 'Pizzería Acapella' },
      { index: 2, entityId: 'b', label: 'Acapella Eventos' },
      { index: 3, entityId: 'c', label: 'Acapella Salto' },
    ],
    resume: {
      originalUserText: 'mostrame los pedidos de Acapella',
      blockedTool: 'list_orders',
      blockedArgs: { clientQuery: 'Acapella' },
    },
  });
  return {
    businessId: 'rilo',
    phone: tenant.phone,
    updatedAt: new Date().toISOString(),
    ...awaiting,
  } as ConversationState;
}

const noopPersist = {
  rememberOp: async () => {},
  clearState: async () => {},
  saveState: async (_b: string, _p: string, patch: Partial<ConversationState>) =>
    ({ businessId: 'rilo', phone: tenant.phone, updatedAt: new Date().toISOString(), ...patch }) as ConversationState,
  appendTurns: async () => {},
  assertAi: async () => {},
};

describe('V4 candidate selection protocol', () => {
  it('parseNumericSelectionTurn separa número y semántica', () => {
    assert.deepEqual(parseNumericSelectionTurn('2'), { index: 2 });
    assert.deepEqual(parseNumericSelectionTurn('2, solo los pendientes'), {
      index: 2,
      remainder: 'solo los pendientes',
    });
    assert.deepEqual(parseNumericSelectionTurn('1 y mostrame los de agosto'), {
      index: 1,
      remainder: 'y mostrame los de agosto',
    });
  });

  it('resolveCandidateSelectionTurn invalida fuera de rango', () => {
    const awaiting = getCandidateSelectionAwaiting(candidateState())!;
    assert.equal(resolveCandidateSelectionTurn('7', awaiting).kind, 'invalid');
    assert.equal(resolveCandidateSelectionTurn('hola', awaiting).kind, 'not_applicable');
  });

  it('isExactNumericOnly solo acepta dígitos solos', () => {
    assert.equal(isExactNumericOnly('2'), true);
    assert.equal(isExactNumericOnly('2, pendientes'), false);
  });
});

describe('V4 turn: numeric selection without LLM', () => {
  it('"2" resumes blocked tool and does not call agent', async () => {
    let agentCalls = 0;

    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '2', messageId: 'pick-2' },
        text: '2',
        state: candidateState(),
      },
      {
        ...noopPersist,
        createAgent: () => {
          agentCalls += 1;
          throw new Error('LLM must not run on exact numeric pick');
        },
        resumeAfterSelection: async () => ({
          reply: 'Pedidos de Acapella Eventos:\n1. #00229 · Listo · $900',
          statePatch: {
            pendingIntent: null,
            pendingPayload: null,
            activeTask: null,
            focusEntities: { client: { id: 'b', name: 'Acapella Eventos', locked: true } },
          },
        }),
      }
    );

    assert.equal(agentCalls, 0);
    assert.equal(result.intent, 'v4_candidate_selected');
    assert.match(result.reply, /Acapella Eventos/);
  });

  it('"7" replies invalid without LLM', async () => {
    let agentCalls = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '7', messageId: 'pick-bad' },
        text: '7',
        state: candidateState(),
      },
      {
        ...noopPersist,
        createAgent: () => {
          agentCalls += 1;
          throw new Error('LLM must not run');
        },
      }
    );
    assert.equal(agentCalls, 0);
    assert.equal(result.intent, 'v4_candidate_invalid');
    assert.match(result.reply, /Respondeme con un número del 1 al 3/);
  });

  it('"2, solo los pendientes" selects B and sends remainder to agent', async () => {
    let agentCalls = 0;
    let agentText = '';

    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '2, solo los pendientes', messageId: 'pick-sem' },
        text: '2, solo los pendientes',
        state: candidateState(),
      },
      {
        ...noopPersist,
        createAgent: () => {
          agentCalls += 1;
          return {
            runTurn: async (input) => {
              agentText = input.text;
              return { reply: 'ok pending filter', executed: false, intent: 'agent_v4' };
            },
          };
        },
      }
    );

    assert.equal(agentCalls, 1);
    assert.equal(agentText, 'solo los pendientes');
    assert.equal(result.reply, 'ok pending filter');
  });
});
