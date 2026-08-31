import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  normalizeTurnInterpretation,
  overlayKnownEntities,
  parseGeminiCash,
  turnInterpretationToParsed,
  type TurnInterpretation,
} from './turn-interpretation.ts';
import {
  matchDeterministicBypass,
  shouldClearPendingForTurn,
} from './conversation-orchestrator-v2.ts';
import { conversationEngineVersion, isLlmFirstEngine } from './engine-version.ts';
import { setLanguageInterpreter, type LanguageInterpreter } from './language-interpreter.ts';
import { extractProductHintFromText } from './lookups.ts';
import type { ConversationState } from './conversation-state.ts';
import type { LineItemIntent } from './conversation-contract.ts';

const FOCUS = {
  id: 'ord-00236',
  label: '00236',
  clientName: 'Laissmachado',
  status: 'pendiente',
};

const RAW = {
  machadoStatus: 'en que estado esta el pedido de machado?',
  pasalo: 'pasalo a estado entregado',
  desconta: 'desconta el total del pedido',
  howTo30: 'quiero registrar un pedido de 30 productos, cómo te paso la información?',
  canguroPago: 'un canguro XL rojo con diseño Ceibal ya está pago $1550',
  movelo: 'movelo a entregado',
  mananaDiseno: 'mañana y cambiale el diseño a Ceibal 2026',
  talleL: 'no, el talle es L',
} as const;

function fakeInterpreter(output: TurnInterpretation): LanguageInterpreter {
  return {
    async interpretTurn(input) {
      return { ...output, rawMessage: output.rawMessage || String(input.text ?? '') };
    },
  };
}

afterEach(() => {
  setLanguageInterpreter(null);
});

describe('Engine flag', () => {
  it('llm_first es el default; legacy es opt-in', () => {
    assert.equal(conversationEngineVersion(''), 'llm_first');
    assert.equal(isLlmFirstEngine('legacy'), false);
    assert.equal(isLlmFirstEngine('llm_first'), true);
    assert.equal(isLlmFirstEngine('v3'), true);
    assert.equal(conversationEngineVersion('v3'), 'v3');
  });
});

describe('Bypass determinístico (sin LLM)', () => {
  it('sí/no exactos confirman o cancelan un plan', () => {
    const state = { pendingIntent: 'confirm:create_order' } as ConversationState;
    assert.deepEqual(matchDeterministicBypass('sí', state), { kind: 'confirm' });
    assert.deepEqual(matchDeterministicBypass('no', state), { kind: 'cancel' });
    assert.equal(matchDeterministicBypass('sí, pero el talle es L', state), null);
  });

  it('un número exacto elige de una lista ya mostrada', () => {
    const state = { pendingIntent: 'select_client' } as ConversationState;
    assert.deepEqual(matchDeterministicBypass('2', state), { kind: 'choice', index: 2 });
    assert.equal(matchDeterministicBypass('2 y agregale otra XL', state), null);
  });
});

describe('Dataset real → TurnInterpretation (contratos, no regex)', () => {
  it('consulta de stock del producto en foco no se mapea a pedido', () => {
    const interpretation: TurnInterpretation = {
      intent: 'query_stock',
      confidence: 0.93,
      conversationAction: 'new_task',
      rawMessage: 'Cómo quedó ese producto en el stock -1?',
      targetReference: { type: 'focused_product' },
      query: { metric: 'stock', expectedValue: -1 },
    };
    const parsed = turnInterpretationToParsed(interpretation, {
      focusOrder: FOCUS,
      focusEntities: {
        product: { id: 'sku-canguro-rojo-xl', name: 'Canguro felpa Rojo XL', locked: true },
      },
    });
    assert.equal(parsed.intent, 'query_stock');
    assert.equal(shouldClearPendingForTurn(interpretation), true);
    assert.equal('entities' in parsed && parsed.entities?.productId, 'sku-canguro-rojo-xl');
    assert.equal('entities' in parsed && parsed.entities?.targetOrderId, undefined);
    assert.equal('entities' in parsed && parsed.entities?.queryExpectedValue, -1);
  });

  it('consulta Machado: new_task query_status usa el foco, no resume', () => {
    const interpretation: TurnInterpretation = {
      intent: 'query_status',
      confidence: 0.9,
      conversationAction: 'new_task',
      rawMessage: RAW.machadoStatus,
      targetReference: { clientHint: 'machado' },
    };
    const parsed = turnInterpretationToParsed(interpretation, { focusOrder: FOCUS });
    assert.equal(parsed.intent, 'query_status');
    assert.equal(parsed.conversationAction, 'new_task');
    assert.equal(shouldClearPendingForTurn(interpretation), true);
    assert.equal('entities' in parsed && parsed.entities?.targetOrderId, 'ord-00236');
    assert.equal('entities' in parsed && parsed.entities?.targetOrderLabel, '00236');
    assert.equal('entities' in parsed && parsed.entities?.items, undefined);
    const poison = extractProductHintFromText(RAW.machadoStatus);
    assert.ok(poison);
    assert.notEqual('entities' in parsed ? parsed.entities?.productName : '', poison);
  });

  it('listado new_task con cliente explícito no hereda el pedido en foco', () => {
    const interpretation: TurnInterpretation = {
      intent: 'query_status',
      confidence: 0.9,
      conversationAction: 'new_task',
      rawMessage: 'consulta',
      client: { raw: 'Cliente B' },
      query: { entity: 'orders', metric: 'list' },
      filters: { listOrders: true },
    };
    const parsed = turnInterpretationToParsed(interpretation, { focusOrder: FOCUS });
    assert.equal('entities' in parsed && parsed.entities?.clientName, 'Cliente B');
    assert.equal('entities' in parsed && parsed.entities?.listOrders, true);
    assert.equal('entities' in parsed && parsed.entities?.targetOrderId, undefined);
  });

  it('pasalo a entregado: update_order_status sin items', () => {
    const interpretation: TurnInterpretation = {
      intent: 'update_order_status',
      confidence: 0.92,
      conversationAction: 'new_task',
      rawMessage: RAW.pasalo,
      orderStatus: 'entregado',
      targetReference: 'focused_order',
    };
    const parsed = turnInterpretationToParsed(interpretation, { focusOrder: FOCUS });
    assert.equal(parsed.intent, 'update_order_status');
    assert.equal('entities' in parsed && parsed.entities?.orderStatus, 'entregado');
    assert.equal('entities' in parsed && parsed.entities?.targetOrderId, 'ord-00236');
    assert.equal('entities' in parsed && parsed.entities?.items, undefined);
    assert.equal('entities' in parsed && parsed.entities?.productName, undefined);
  });

  it('desconta el total: misma operación, stockResolution, no create_order', () => {
    const interpretation: TurnInterpretation = {
      intent: 'update_order_status',
      confidence: 0.9,
      conversationAction: 'answer_current',
      rawMessage: RAW.desconta,
      stockResolution: 'discount_full_order',
      targetReference: 'focused_order',
    };
    const parsed = turnInterpretationToParsed(interpretation, {
      focusOrder: FOCUS,
      pendingIntent: 'stock_resolution',
      awaiting: 'stock_resolution',
    });
    assert.equal(parsed.intent, 'update_order_status');
    assert.notEqual(parsed.intent, 'create_order');
    assert.equal('entities' in parsed && parsed.entities?.stockResolution, 'discount_full_order');
    assert.equal(shouldClearPendingForTurn(interpretation), false);
    assert.equal('entities' in parsed && parsed.entities?.items, undefined);
  });

  it('cómo pasar 30 productos: how_to, no create_order', () => {
    const interpretation: TurnInterpretation = {
      intent: 'how_to',
      confidence: 0.93,
      conversationAction: 'answer_current',
      rawMessage: RAW.howTo30,
      helpTopic: 'create_order',
      expectedItemCount: 30,
    };
    const parsed = turnInterpretationToParsed(interpretation);
    assert.equal(parsed.intent, 'how_to');
    assert.equal('entities' in parsed && parsed.entities?.helpTopic, 'create_order');
    assert.equal('entities' in parsed && parsed.entities?.expectedItemCount, 30);
    assert.equal('entities' in parsed && parsed.entities?.items, undefined);
  });

  it('canguro + Ceibal + pago: create_order items[] notes payment, no reconstruye raw', () => {
    const interpretation: TurnInterpretation = {
      intent: 'create_order',
      confidence: 0.91,
      conversationAction: 'new_task',
      rawMessage: RAW.canguroPago,
      items: [
        {
          quantity: 1,
          rawText: 'canguro XL rojo',
          productHint: 'canguro',
          itemKey: 'item:1',
          attributes: { type: 'canguro', size: 'XL', color: 'rojo' },
        },
      ],
      notes: 'Ceibal',
      payment: { full: true, amount: 1550 },
    };
    const parsed = turnInterpretationToParsed(interpretation);
    assert.equal(parsed.intent, 'create_order');
    assert.ok('entities' in parsed);
    const entities = parsed.entities ?? {};
    assert.equal(entities.notes, 'Ceibal');
    assert.equal(entities.paid, true);
    assert.equal(entities.payFullBalance, true);
    assert.equal(entities.amount, 1550);
    assert.equal(entities.items?.length, 1);
    assert.equal(entities.items?.[0]?.itemKey, 'item:1');
    assert.equal(entities.items?.[0]?.attributes?.size, 'XL');
    assert.notEqual(entities.notes, RAW.canguroPago);
    assert.notEqual(entities.items?.[0]?.rawText, RAW.canguroPago);
  });

  it('movelo a entregado mantiene el mismo foco', () => {
    const interpretation: TurnInterpretation = {
      intent: 'update_order_status',
      confidence: 0.9,
      conversationAction: 'new_task',
      rawMessage: RAW.movelo,
      orderStatus: 'entregado',
      targetReference: 'focused_order',
    };
    const parsed = turnInterpretationToParsed(interpretation, { focusOrder: FOCUS });
    assert.equal('entities' in parsed && parsed.entities?.targetOrderId, 'ord-00236');
    assert.equal('entities' in parsed && parsed.entities?.orderStatus, 'entregado');
  });

  it('mañana + diseño: answer_current no pisa el ítem, suma fecha y notes', () => {
    const known = {
      clientName: 'Laissmachado',
      items: [
        {
          quantity: 1,
          rawText: 'canguro XL rojo',
          itemKey: 'item:1',
          attributes: { type: 'canguro', size: 'XL', color: 'rojo' },
        },
      ],
    };
    const interpretation: TurnInterpretation = {
      intent: 'create_order',
      confidence: 0.88,
      conversationAction: 'answer_current',
      rawMessage: RAW.mananaDiseno,
      dates: { delivery: '2026-08-30' },
      notes: 'Ceibal 2026',
    };
    const incoming = turnInterpretationToParsed(interpretation);
    const merged = overlayKnownEntities(known, 'entities' in incoming ? incoming.entities ?? {} : {}, 'answer_current');
    assert.equal(merged.deliveryDate, '2026-08-30');
    assert.equal(merged.notes, 'Ceibal 2026');
    assert.equal(merged.items?.length, 1);
    assert.equal(merged.items?.[0]?.itemKey, 'item:1');
    assert.equal(merged.clientName, 'Laissmachado');
  });

  it('no, el talle es L: mismo itemKey, no duplica renglón', () => {
    const previous: LineItemIntent[] = [
      {
        quantity: 1,
        rawText: 'canguro XL rojo',
        itemKey: 'item:1',
        attributes: { type: 'canguro', size: 'XL', color: 'rojo' },
      },
    ];
    const incoming: LineItemIntent[] = [
      {
        quantity: 1,
        rawText: 'canguro L rojo',
        itemKey: 'item:1',
        attributes: { type: 'canguro', size: 'L', color: 'rojo' },
      },
    ];
    const merged = overlayKnownEntities(
      { items: previous },
      { items: incoming, rawUserMessage: RAW.talleL },
      'correct_current'
    );
    assert.equal(merged.items?.length, 1);
    assert.equal(merged.items?.[0]?.itemKey, 'item:1');
    assert.equal(merged.items?.[0]?.attributes?.size, 'L');
  });
});

describe('register_cash: alias Gemini movementType/scope', () => {
  it('expense + business + Nuñez → egreso, caja negocio, concepto intacto', () => {
    const cash = parseGeminiCash({
      movementType: 'expense',
      scope: 'business',
      amount: 370,
      concept: 'Nuñez',
    });
    assert.equal(cash?.type, 'egreso');
    assert.equal(cash?.ambitoHint, 'negocio');
    assert.equal(cash?.concept, 'Nuñez');
    assert.equal(cash?.amount, 370);

    const interpretation = normalizeTurnInterpretation(
      {
        intent: 'register_cash',
        conversationAction: 'new_task',
        cash: {
          movementType: 'expense',
          scope: 'business',
          amount: 370,
          concept: 'Nuñez',
        },
      },
      'egreso 370 nuñez'
    );
    const parsed = turnInterpretationToParsed(interpretation);
    assert.equal(parsed.intent, 'register_cash');
    assert.equal('entities' in parsed && parsed.entities?.cashType, 'egreso');
    assert.equal('entities' in parsed && parsed.entities?.cashAmbitoHint, 'negocio');
    assert.equal('entities' in parsed && parsed.entities?.cashConcept, 'Nuñez');
    assert.equal('entities' in parsed && parsed.entities?.amount, 370);
  });
});

describe('Fake LanguageInterpreter', () => {
  it('inyecta el structured output sin parseWithRules', async () => {
    setLanguageInterpreter(
      fakeInterpreter({
        intent: 'query_status',
        confidence: 1,
        conversationAction: 'new_task',
        rawMessage: RAW.machadoStatus,
        targetReference: 'focused_order',
      })
    );
    const { interpretLlmFirstTurn } = await import('./conversation-orchestrator-v2.ts');
    const result = await interpretLlmFirstTurn({
      text: RAW.machadoStatus,
      conversation: { focusOrder: FOCUS, pendingIntent: 'clarify' },
    });
    assert.equal(result.parsed.intent, 'query_status');
    assert.equal(result.clearPending, true);
    assert.equal('entities' in result.parsed && result.parsed.entities?.targetOrderId, 'ord-00236');
  });

  it('timeout del proveedor no se trata como unknown semántico', async () => {
    setLanguageInterpreter(
      fakeInterpreter({
        intent: 'unknown',
        confidence: 0,
        conversationAction: 'new_task',
        rawMessage: 'consulta',
        interpreterFailure: {
          kind: 'INTERPRETER_TIMEOUT',
          provider: 'gemini',
          model: 'gemini-flash-lite-latest',
          durationMs: 8000,
          retry: true,
          fallbackUsed: true,
          errorType: 'timeout',
          httpStatus: null,
        },
      })
    );
    const { interpretLlmFirstTurn } = await import('./conversation-orchestrator-v2.ts');
    const { isInterpreterTechnicalFailure } = await import('./interpreter-availability.ts');
    const result = await interpretLlmFirstTurn({ text: 'consulta' });
    assert.equal(result.clearPending, false);
    assert.equal(isInterpreterTechnicalFailure(result.interpretation.interpreterFailure), true);
    assert.equal(result.interpretation.interpreterFailure?.kind, 'INTERPRETER_TIMEOUT');
    assert.equal(result.parsed.intent, 'interpreter_unavailable');
  });
});
