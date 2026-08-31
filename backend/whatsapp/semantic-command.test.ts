import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTurnInterpretation } from './turn-interpretation.ts';
import {
  meaningEquivalent,
  resolveSemanticTurn,
  semanticCommandToLegacyEntities,
  shouldClearPendingForCommand,
  snapshotFromInterpretation,
  snapshotFromPlan,
  calendarDayAr,
  resolveDateToken,
  cashCommandFromOperation,
} from './semantic-command.ts';
import { buildOperationPlanFromCommand } from './operation-plan.ts';
import type { WhatsappParseConversation } from './ai-command-parser.ts';

function fromLlm(raw: Record<string, unknown>, message: string, conversation?: WhatsappParseConversation) {
  const interpretation = normalizeTurnInterpretation(raw, message);
  const resolved = resolveSemanticTurn(interpretation, conversation);
  const plan = buildOperationPlanFromCommand(resolved.command);
  const llmSnap = snapshotFromInterpretation(interpretation);
  const planSnap = snapshotFromPlan(plan);
  const eq = meaningEquivalent(llmSnap, planSnap, { allowIntentSalvage: true });
  return { interpretation, resolved, plan, llmSnap, planSnap, eq };
}

describe('SemanticCommand: cash vs payment', () => {
  it('payment.amount en register_cash se mueve a cash.amount (sin leer el utterance)', () => {
    const { resolved, plan, eq } = fromLlm(
      {
        intent: 'register_cash',
        conversationAction: 'new_task',
        cash: { type: 'egreso' },
        payment: { full: false, amount: 430 },
      },
      'pagamos 430 de la garrafa con plata del negocio'
    );
    assert.equal(resolved.command.operations[0]?.intent, 'register_cash');
    assert.equal(resolved.command.operations[0]?.cash?.amount, 430);
    assert.equal(resolved.command.operations[0]?.payment, undefined);
    assert.equal(plan.operations[0]?.payload.amount, 430);
    assert.equal(plan.operations[0]?.payload.cashAmount, 430);
    assert.ok(resolved.command.schemaWarnings.some((w) => w.includes('payment.amount → cash.amount')));
    assert.equal(eq.ok, true, eq.diffs.join(', '));
  });

  it('no contamina register_cash con cliente "caja"', () => {
    const { resolved } = fromLlm(
      {
        intent: 'register_cash',
        conversationAction: 'new_task',
        client: { name: 'caja' },
        cash: { type: 'ingreso', amount: 900, concept: 'trabajo', date: 'ayer' },
      },
      'ayer entraron 900 a caja por un trabajo'
    );
    assert.equal(resolved.command.operations[0]?.client, undefined);
    assert.ok(resolved.command.discardedUnexpectedFields.includes('client'));
    assert.equal(resolved.command.operations[0]?.cash?.amount, 900);
    assert.equal(resolved.command.operations[0]?.cash?.date, resolveDateToken('ayer', calendarDayAr()));
  });
});

describe('Generalización: LLM JSON → plan (sin frases en el prompt)', () => {
  it('A garrafa / negocio / 430', () => {
    const { plan, eq, resolved } = fromLlm(
      {
        intent: 'register_cash',
        conversationAction: 'new_task',
        cash: {
          movementType: 'expense',
          amount: 430,
          concept: 'garrafa',
          scope: 'business',
        },
      },
      'pagamos 430 de la garrafa con plata del negocio'
    );
    const cash = resolved.command.operations[0]?.cash;
    assert.equal(cash?.type, 'egreso');
    assert.equal(cash?.amount, 430);
    assert.equal(cash?.concept, 'garrafa');
    assert.equal(cash?.scope, 'negocio');
    assert.equal(plan.operations[0]?.intent, 'register_cash');
    assert.equal(eq.ok, true, eq.diffs.join(', '));
  });

  it('B flete 275', () => {
    const { resolved, eq } = fromLlm(
      {
        intent: 'register_cash',
        conversationAction: 'new_task',
        cash: { type: 'egreso', amount: 275, concept: 'flete' },
      },
      'sacame 275 de la caja por el flete de hoy'
    );
    assert.equal(resolved.command.operations[0]?.cash?.amount, 275);
    assert.equal(resolved.command.operations[0]?.cash?.concept, 'flete');
    assert.equal(eq.ok, true, eq.diffs.join(', '));
  });

  it('C Natalia pronto + cobro saldo', () => {
    const conversation: WhatsappParseConversation = {
      focusOrder: { id: 'ord-n', label: '00401', clientName: 'Natalia', status: 'pendiente' },
    };
    const { resolved, plan, eq } = fromLlm(
      {
        intent: 'update_order_status',
        conversationAction: 'new_task',
        requestedStatus: 'listo',
        targetReference: 'focused_order',
        dates: { delivery: 'pasado mañana' },
        payment: { full: true, fullBalance: true },
        client: { raw: 'Natalia' },
      },
      'a Natalia dejale el pedido pronto para pasado mañana y cobrale lo que falta',
      conversation
    );
    assert.equal(resolved.command.operations[0]?.intent, 'update_order_status');
    assert.equal(resolved.command.operations.some((op) => op.intent === 'register_payment'), true);
    assert.equal(resolved.command.operations[0]?.dates?.delivery, resolveDateToken('pasado mañana', calendarDayAr()));
    assert.ok(plan.operations.length >= 2);
    assert.equal(eq.ok, true, eq.diffs.join(', '));
  });

  it('D corrección multi-ítem no es new_task', () => {
    const conversation: WhatsappParseConversation = {
      pendingIntent: 'confirm:create_order',
      knownEntities: {
        clientName: 'Ana',
        items: [
          { quantity: 1, rawText: 'canguro negro L', itemKey: 'item:1', attributes: { size: 'L' } },
          { quantity: 1, rawText: 'canguro rojo L', itemKey: 'item:2', attributes: { size: 'L' } },
          { quantity: 1, rawText: 'buzo gris L', itemKey: 'item:3', attributes: { size: 'L' } },
        ],
      },
    };
    const { resolved } = fromLlm(
      {
        intent: 'unknown',
        conversationAction: 'new_task',
        items: [
          { rawText: 'canguro negro M', itemKey: 'item:1', quantity: 1, attributes: { size: 'M' } },
          { rawText: 'canguro rojo M', itemKey: 'item:2', quantity: 1, attributes: { size: 'M' } },
          { rawText: 'buzo gris XL', itemKey: 'item:3', quantity: 1, attributes: { size: 'XL' } },
        ],
      },
      'los dos primeros son M, el otro dejalo XL',
      conversation
    );
    assert.equal(resolved.command.conversationAction, 'correct_current');
    assert.notEqual(resolved.command.operations[0]?.intent, 'unknown');
    assert.equal(shouldClearPendingForCommand(resolved.command), false);
  });

  it('E query_stock con producto en foco', () => {
    const { resolved, eq } = fromLlm(
      {
        intent: 'query_stock',
        conversationAction: 'new_task',
        targetReference: 'focused_product',
        query: { metric: 'stock' },
      },
      'ese que vimos recién cuánto queda?',
      {
        focusEntities: { product: { id: 'sku-1', name: 'Canguro', locked: true } },
      }
    );
    assert.equal(resolved.command.operations[0]?.intent, 'query_stock');
    assert.equal(eq.ok, true, eq.diffs.join(', '));
  });

  it('F ingreso 900 trabajo ayer', () => {
    const { resolved, eq } = fromLlm(
      {
        intent: 'register_cash',
        conversationAction: 'new_task',
        cash: { type: 'ingreso', amount: 900, concept: 'trabajo', date: 'yesterday' },
      },
      'ayer entraron 900 a caja por un trabajo'
    );
    assert.equal(resolved.command.operations[0]?.cash?.type, 'ingreso');
    assert.equal(resolved.command.operations[0]?.cash?.amount, 900);
    assert.equal(resolved.command.operations[0]?.cash?.concept, 'trabajo');
    assert.ok(resolved.command.operations[0]?.cash?.date);
    assert.equal(eq.ok, true, eq.diffs.join(', '));
  });
});

describe('meaningEquivalent invariante', () => {
  it('detecta 430 → 0', () => {
    const result = meaningEquivalent(
      { intent: 'register_cash', conversationAction: 'new_task', cashAmount: 430, cashType: 'egreso' },
      { intent: 'register_cash', conversationAction: 'new_task', cashAmount: 0, cashType: 'egreso' }
    );
    assert.equal(result.ok, false);
    assert.ok(result.diffs.some((d) => d.includes('cashAmount')));
  });

  it('adapter legacy no pierde cash.amount', () => {
    const { resolved } = fromLlm(
      {
        intent: 'register_cash',
        conversationAction: 'new_task',
        cash: { type: 'egreso', amount: 275, concept: 'flete' },
      },
      'x'
    );
    const entities = semanticCommandToLegacyEntities(resolved.command);
    assert.equal(entities.amount, 275);
    assert.equal(entities.cashType, 'egreso');
    assert.equal(entities.paid, undefined);
  });

  it('register_cash sin amount no fabrica $0', () => {
    const { resolved, plan } = fromLlm(
      {
        intent: 'register_cash',
        conversationAction: 'new_task',
        cash: { type: 'egreso', concept: 'garrafa' },
      },
      'x'
    );
    assert.equal(resolved.command.missingFields?.includes('cash.amount'), true);
    assert.equal(plan.operations[0]?.payload.amount, undefined);
    const cmd = cashCommandFromOperation('biz', resolved.command.operations[0]!);
    assert.equal('error' in cmd, true);
  });

  it('operations[] query_status vacío no pisa el cobro', () => {
    const { resolved, plan } = fromLlm(
      {
        intent: 'update_order_status',
        conversationAction: 'new_task',
        requestedStatus: 'listo',
        payment: { full: true, fullBalance: true },
        operations: [{ intent: 'query_status' }],
      },
      'x'
    );
    assert.equal(resolved.command.operations.some((op) => op.intent === 'register_payment'), true);
    assert.equal(resolved.command.operations.some((op) => op.intent === 'query_status'), false);
    assert.ok(plan.operations.some((op) => op.intent === 'register_payment'));
  });
});
