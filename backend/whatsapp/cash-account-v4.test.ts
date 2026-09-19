import { resolveCashAccountFromCaja } from './resolve-cash-account.ts';
import { presentCashBalance, presentCashMovements, presentConfirmationPlan } from './agent/agent-presenter.ts';
import { buildAgentOperationPlan, normalizeCashMovementType } from './agent/tools/write-tools.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { buildCandidateSelectionState } from './v4-candidate-selection.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function cajaFixture(labels: string[]): Record<string, unknown> {
  const extras = labels.slice(1).map((label, index) => ({
    id: `caja_${index + 2}`,
    label,
  }));
  return {
    ambitos: [{ id: 'negocio', label: labels[0] }, ...extras],
  };
}

const tenant: WhatsappTenantContext = {
  businessId: 'test-biz',
  phone: '+59899111111',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

describe('normalizeCashMovementType', () => {
  it('acepta type exacto e aliases del LLM', () => {
    assert.equal(normalizeCashMovementType({ type: 'ingreso' }), 'ingreso');
    assert.equal(normalizeCashMovementType({ type: 'Egreso' }), 'egreso');
    assert.equal(normalizeCashMovementType({ tipo: 'ingreso' }), 'ingreso');
    assert.equal(normalizeCashMovementType({ cashType: 'egreso' }), 'egreso');
    assert.equal(normalizeCashMovementType({ type: 'ingreso a caja' }), 'ingreso');
    assert.equal(normalizeCashMovementType({ type: 'gasto / egreso' }), 'egreso');
    assert.equal(normalizeCashMovementType({ type: null }), null);
    assert.equal(normalizeCashMovementType({}), null);
  });
});

describe('resolveCashAccountFromCaja', () => {
  const twoCajas = cajaFixture(['Caja A', 'Caja B']);

  it('resuelve hint explícito a Caja B', () => {
    const result = resolveCashAccountFromCaja(twoCajas, {
      hint: 'Caja B',
      explicit: true,
    });
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.account.id, 'caja_2');
      assert.equal(result.account.name, 'Caja B');
    }
  });

  it('una sola caja autoselecciona sin preguntar', () => {
    const single = cajaFixture(['Caja A']);
    const result = resolveCashAccountFromCaja(single, {});
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.account.id, 'negocio');
      assert.equal(result.account.name, 'Caja A');
    }
  });

  it('varias cajas sin hint pide selección', () => {
    const result = resolveCashAccountFromCaja(twoCajas, {});
    assert.equal(result.status, 'needs_selection');
    if (result.status === 'needs_selection') {
      assert.equal(result.candidates.length, 2);
      assert.equal(result.candidates[1]?.name, 'Caja B');
    }
  });

  it('hint inexistente devuelve not_found sin fallback', () => {
    const result = resolveCashAccountFromCaja(twoCajas, {
      hint: 'Caja inexistente',
      explicit: true,
    });
    assert.equal(result.status, 'not_found');
  });

  it('contexto stale: hint Caja B gana sobre resolvedId Caja A', () => {
    const result = resolveCashAccountFromCaja(twoCajas, {
      hint: 'Caja B',
      resolvedId: 'negocio',
      explicit: true,
    });
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.account.name, 'Caja B');
    }
  });

  it('hereda caja del contexto cuando no hay hint explícito', () => {
    const result = resolveCashAccountFromCaja(twoCajas, {
      resolvedId: 'caja_2',
      explicit: false,
    });
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.account.name, 'Caja B');
    }
  });

  it('resuelve label Personal contra id casa (modelo ERP real)', () => {
    const riloLike = {
      ambitos: [
        { id: 'negocio', label: 'Rilo' },
        { id: 'casa', label: 'Personal' },
      ],
    };
    const result = resolveCashAccountFromCaja(riloLike, {
      hint: 'personal',
      explicit: true,
    });
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.account.id, 'casa');
      assert.equal(result.account.name, 'Personal');
    }
  });

  it('resuelve hint "rilo" a la caja Rilo (negocio)', () => {
    const riloLike = {
      ambitos: [
        { id: 'negocio', label: 'Rilo' },
        { id: 'casa', label: 'Personal' },
      ],
    };
    const result = resolveCashAccountFromCaja(riloLike, {
      hint: 'rilo',
      explicit: true,
    });
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.account.id, 'negocio');
      assert.equal(result.account.name, 'Rilo');
    }
  });

  it('resuelve hint compuesto "caja de rilo"', () => {
    const riloLike = {
      ambitos: [
        { id: 'negocio', label: 'Rilo' },
        { id: 'casa', label: 'Personal' },
      ],
    };
    const result = resolveCashAccountFromCaja(riloLike, {
      hint: 'caja de rilo',
      explicit: true,
    });
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.account.id, 'negocio');
      assert.equal(result.account.name, 'Rilo');
    }
  });
});

describe('presentCashMovements filter preservation', () => {
  it('incluye el nombre de caja en el título y no mezcla ámbitos', () => {
    const text = presentCashMovements({
      status: 'resolved',
      cashAccountName: 'Rilo',
      filter: { cashAccountName: 'Rilo', limit: 10 },
      items: [
        {
          type: 'ingreso',
          amount: 1800,
          concept: 'Cuota pedido #00239',
          date: '2026-09-04T15:09:00.000Z',
        },
        {
          type: 'egreso',
          amount: 4009,
          concept: 'Lorelei Paique OCA Master',
          date: '2026-09-03T00:06:00.000Z',
        },
      ],
    });
    assert.match(text, /Rilo/);
    assert.match(text, /Ingreso/);
    assert.doesNotMatch(text, /\(casa\)/i);
    assert.doesNotMatch(text, /Personal/i);
  });

  it('filter_blocked pide selección de caja', () => {
    const text = presentCashMovements({
      status: 'filter_blocked',
      errorCode: 'ENTITY_AMBIGUOUS',
      entityType: 'cash_account',
      title: '¿De qué caja?',
      candidates: [
        { id: 'negocio', name: 'Rilo', label: 'Rilo' },
        { id: 'casa', name: 'Personal', label: 'Personal' },
      ],
    });
    assert.match(text, /caja/i);
    assert.match(text, /1\.\s*Rilo/);
    assert.match(text, /2\.\s*Personal/);
  });

  it('saldo con caja nombrada refleja el filtro', () => {
    const text = presentCashBalance({
      status: 'resolved',
      cashAccountName: 'Rilo',
      saldo: 12000,
      byAmbito: [{ id: 'negocio', label: 'Rilo', saldo: 12000 }],
      empty: false,
    });
    assert.match(text, /Rilo/);
    assert.match(text, /12\.?000|12000/);
  });
});

describe('register_cash_movement confirmation label', () => {
  it('incluye la caja resuelta en el plan congelado con negrita válida', () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'register_cash_movement',
          label: 'Ingreso $1.000 · Zulma',
          summaryTitle: 'Ingreso $1.000 · Zulma',
          summaryLines: ['Caja: Caja B'],
          args: {
            type: 'ingreso',
            amount: 1000,
            concept: 'Zulma',
            ambitoId: 'caja_2',
            cashAccountId: 'caja_2',
            cashAccountName: 'Caja B',
          },
        },
      ],
      'ingreso en caja B'
    );

    const confirmation = presentConfirmationPlan(plan);
    assert.match(confirmation, /^\*Ingreso \$1\.000 · Zulma\*$/m);
    assert.match(confirmation, /^Caja: Caja B$/m);
    assert.doesNotMatch(confirmation, /\*[^\n]*\n[^\n]*\*/);
    assert.match(confirmation, /¿Confirmo\? \*Sí\* \/ \*No\*/);
    assert.equal(plan.writes[0]?.args.ambitoId, 'caja_2');
  });
});

describe('V4 cash_account numeric selection', () => {
  function cashCandidateState(blockedTool = 'register_cash_movement'): ConversationState {
    const awaiting = buildCandidateSelectionState({
      entityType: 'cash_account',
      options: [
        { index: 1, entityId: 'negocio', label: 'Caja A' },
        { index: 2, entityId: 'caja_2', label: 'Caja B' },
      ],
      resume: {
        originalUserText:
          blockedTool === 'list_cash_movements'
            ? 'últimos 10 movimientos'
            : 'anotá un ingreso de 500',
        blockedTool,
        blockedArgs:
          blockedTool === 'list_cash_movements'
            ? { limit: 10 }
            : { type: 'ingreso', amount: 500, concept: 'Varios' },
      },
    });
    return {
      businessId: 'test-biz',
      phone: tenant.phone,
      updatedAt: new Date().toISOString(),
      ...awaiting,
    } as ConversationState;
  }

  it('"2" completa el plan en Caja B sin LLM', async () => {
    let agentCalls = 0;

    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '2', messageId: 'cash-pick-2' },
        text: '2',
        state: cashCandidateState(),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) =>
          ({
            businessId: 'test-biz',
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            ...patch,
          }) as ConversationState,
        appendTurns: async () => {},
        assertAi: async () => {},
        createAgent: () => {
          agentCalls += 1;
          throw new Error('LLM must not run on cash numeric pick');
        },
        resumeAfterSelection: async () => ({
          reply: '*Ingreso $500 · Varios*\nCaja: Caja B\n\n¿Confirmo? *Sí* / *No*',
          statePatch: {
            pendingIntent: 'confirm:v4_write',
            operationPlan: {
              version: 'v4',
              writes: [
                {
                  tool: 'register_cash_movement',
                  label: 'Ingreso $500 · Varios',
                  summaryTitle: 'Ingreso $500 · Varios',
                  summaryLines: ['Caja: Caja B'],
                  args: {
                    type: 'ingreso',
                    amount: 500,
                    concept: 'Varios',
                    ambitoId: 'caja_2',
                    cashAccountId: 'caja_2',
                    cashAccountName: 'Caja B',
                  },
                },
              ],
              summary: { title: 'Ingreso $500 · Varios', lines: ['Caja: Caja B'] },
              rawUserMessage: 'anotá un ingreso de 500',
            },
          },
        }),
      }
    );

    assert.equal(agentCalls, 0);
    assert.equal(result.intent, 'v4_candidate_selected');
    assert.match(result.reply, /Caja B/);
    assert.match(result.reply, /¿Confirmo\?/);
  });

  it('"1" reanuda list_cash_movements con caja elegida', async () => {
    let agentCalls = 0;
    let resumeArgs: Record<string, unknown> | null = null;

    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '1', messageId: 'cash-list-pick-1' },
        text: '1',
        state: cashCandidateState('list_cash_movements'),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) =>
          ({
            businessId: 'test-biz',
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            ...patch,
          }) as ConversationState,
        appendTurns: async () => {},
        assertAi: async () => {},
        createAgent: () => {
          agentCalls += 1;
          throw new Error('LLM must not run on cash list pick');
        },
        resumeAfterSelection: async ({ option, awaiting }) => {
          resumeArgs = {
            entityId: option.entityId,
            blockedTool: awaiting.resume.blockedTool,
            ambitoId: 'negocio',
          };
          return {
            reply: presentCashMovements({
              status: 'resolved',
              cashAccountName: 'Caja A',
              filter: { cashAccountName: 'Caja A', limit: 10 },
              items: [
                { type: 'ingreso', amount: 1000, concept: 'Cuota', date: '2026-09-04T12:00:00.000Z' },
              ],
            }),
            statePatch: {
              pendingIntent: null,
              focusEntities: { cash: { id: 'negocio', name: 'Caja A', locked: true } },
            },
          };
        },
      }
    );

    assert.equal(agentCalls, 0);
    assert.equal(result.intent, 'v4_candidate_selected');
    assert.equal(resumeArgs?.entityId, 'negocio');
    assert.equal(resumeArgs?.blockedTool, 'list_cash_movements');
    assert.match(result.reply, /Caja A/);
    assert.doesNotMatch(result.reply, /Caja B/);
  });
});
