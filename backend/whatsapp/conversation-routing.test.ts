import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWithRules } from './ai-command-parser.ts';
import {
  classifyConversationSpeechAct,
  doesFillCurrentSlot,
  hasExplicitCompleteIntent,
  isFreshTaskUtterance,
  RESUME_CONTEXT_INTENT,
  routeResumeUtterance,
  shouldAskIdleResume,
} from './conversation-follow.ts';
import {
  COLLECT_ORDER_ITEMS_INTENT,
  formatCapabilityOrderReply,
  formatHowToCreateOrder,
  isNonProductUtterance,
  isPlaceholderProductLabel,
  productParserAllowed,
  shouldOpenItemCollection,
  hasRealOrderItems,
  splitCancelAndRemainder,
  utteranceIsCapabilityQuestion,
  utteranceIsHowTo,
} from './conversation-speech.ts';
import { extractProductHintFromText, personNamesLookRelated } from './lookups.ts';
import { appendOrderItemBatch } from './turn-interpreter.ts';
import type { ConversationState } from './conversation-state.ts';
import { applyQueryFollowUp, looksLikeQueryFollowUp } from './query-follow.ts';
import { applyOrderLock, lockedOrderFromFocus } from './order-lock.ts';

const STATUS_UTTERANCE = 'Pásalo a estado entregado';
const HOW_TO_UTTERANCE =
  'Quiero registrar un pedido de 30 productos como te paso la info para los productos y el cliente?';
const OPERATIONAL_UTTERANCE = 'registrame un pedido de 30 productos para María';
const CAPABILITY_UTTERANCE = 'puedo mandarte un pedido con 30 productos?';
const FOCUS = {
  id: 'ord-00236',
  label: '00236',
  clientName: 'Juan',
  status: 'listo',
};

function idleState(pendingIntent: string): ConversationState {
  return {
    businessId: 'biz',
    phone: '+54911',
    pendingIntent,
    pendingPayload: {
      originalIntent: 'create_order',
      missingField: 'productName',
      entities: { clientName: 'Ana' },
    },
    pendingPrompt: '¿Qué producto?',
    focusOrder: FOCUS,
    updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    lastActiveAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  };
}

describe('Routing conversacional — resume vs intención explícita', () => {
  it('Pásalo a estado entregado es update_order_status, no create_order ni producto', () => {
    const parsed = parseWithRules(STATUS_UTTERANCE, { focusOrder: FOCUS });
    assert.equal(parsed.intent, 'update_order_status');
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(entities.orderStatus, 'entregado');
    assert.equal(entities.targetOrderId, FOCUS.id);
    assert.equal(entities.productName, undefined);
    assert.equal(productParserAllowed(parsed.intent), false);
    assert.equal(isNonProductUtterance(STATUS_UTTERANCE), true);
    assert.equal(extractProductHintFromText(STATUS_UTTERANCE), null);
  });

  it('resume_context no trata una orden explícita como respuesta al pending', () => {
    assert.equal(doesFillCurrentSlot(STATUS_UTTERANCE, RESUME_CONTEXT_INTENT, {}), false);
    assert.equal(doesFillCurrentSlot('sí', RESUME_CONTEXT_INTENT, {}), true);
    assert.equal(doesFillCurrentSlot('no', RESUME_CONTEXT_INTENT, {}), true);
    assert.equal(hasExplicitCompleteIntent(STATUS_UTTERANCE), true);
    assert.equal(classifyConversationSpeechAct(STATUS_UTTERANCE, RESUME_CONTEXT_INTENT), 'execute_explicit');

    const route = routeResumeUtterance(STATUS_UTTERANCE, { intent: 'update_order_status', confidence: 0.9 });
    assert.equal(route.kind, 'run_new');
    if (route.kind === 'run_new') assert.equal(route.text, STATUS_UTTERANCE);
  });

  it('idle resume no secuestra una instrucción de estado', () => {
    const state = idleState('select_product');
    assert.equal(shouldAskIdleResume(STATUS_UTTERANCE, state), false);
    assert.equal(isFreshTaskUtterance(STATUS_UTTERANCE, RESUME_CONTEXT_INTENT), true);
  });

  it('sí / no del resume; cola operativa no se pierde', () => {
    assert.equal(routeResumeUtterance('sí', { intent: 'unknown' }).kind, 'resume_yes');
    assert.equal(routeResumeUtterance('no', { intent: 'unknown' }).kind, 'resume_no');
    const compound = splitCancelAndRemainder('no, ahora quiero registrar una venta');
    assert.equal(compound.cancel, true);
    assert.match(compound.remainder, /venta/i);
    const route = routeResumeUtterance('no, ahora quiero registrar una venta', {
      intent: 'create_sale',
      confidence: 0.86,
    });
    assert.equal(route.kind, 'run_new');
    if (route.kind === 'run_new') assert.match(route.text, /venta/i);
    assert.equal(parseWithRules(compound.remainder).intent, 'create_sale');
  });
});

describe('how_to vs create_order vs capability', () => {
  it('pregunta de uso no ejecuta create_order', () => {
    assert.equal(utteranceIsHowTo(HOW_TO_UTTERANCE), true);
    const parsed = parseWithRules(HOW_TO_UTTERANCE);
    assert.equal(parsed.intent, 'how_to');
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(entities.helpTopic, 'create_order');
    assert.equal(entities.expectedItemCount, 30);
    assert.equal(entities.productName, undefined);
    const reply = formatHowToCreateOrder(30);
    assert.match(reply, /30 productos/i);
    assert.match(reply, /LISTO/i);
    assert.doesNotMatch(reply, /No te seguí/i);
  });

  it('registrame un pedido de 30 productos para María es create_order', () => {
    assert.equal(utteranceIsHowTo(OPERATIONAL_UTTERANCE), false);
    const parsed = parseWithRules(OPERATIONAL_UTTERANCE);
    assert.equal(parsed.intent, 'create_order');
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(entities.expectedItemCount, 30);
    assert.match(String(entities.clientName ?? ''), /mar[ií]a/i);
    assert.equal(hasRealOrderItems(entities), false);
    assert.equal(shouldOpenItemCollection(OPERATIONAL_UTTERANCE, entities), true);
  });

  it('puedo mandarte un pedido con 30 productos? es capability_question', () => {
    assert.equal(utteranceIsCapabilityQuestion(CAPABILITY_UTTERANCE), true);
    const parsed = parseWithRules(CAPABILITY_UTTERANCE);
    assert.equal(parsed.intent, 'capability_question');
    assert.match(formatCapabilityOrderReply(), /s[ií]/i);
  });

  it('how_to no llena el slot de collect_order_items', () => {
    assert.equal(
      doesFillCurrentSlot(HOW_TO_UTTERANCE, COLLECT_ORDER_ITEMS_INTENT, {}),
      false
    );
    assert.equal(isFreshTaskUtterance(HOW_TO_UTTERANCE, COLLECT_ORDER_ITEMS_INTENT), false);
  });
});

describe('Pedidos grandes por tandas', () => {
  it('appendOrderItemBatch suma tandas sin reparsear el hilo', () => {
    const first = appendOrderItemBatch(
      [],
      [
        {
          quantity: 2,
          rawText: '2 remeras negras L',
          productHint: 'remeras negras L',
          attributes: { type: 'remera', color: 'negro', size: 'L' },
        },
        {
          quantity: 3,
          rawText: '3 XL blancas',
          productHint: 'XL blancas',
          attributes: { type: 'remera', color: 'blanco', size: 'XL' },
        },
      ],
      '2 remeras negras L, 3 XL blancas'
    );
    assert.equal(first.length, 2);
    const second = appendOrderItemBatch(
      first,
      [
        {
          quantity: 4,
          rawText: '4 canguros rojos M',
          productHint: 'canguros rojos M',
          attributes: { type: 'canguro', color: 'rojo', size: 'M' },
        },
      ],
      '4 canguros rojos M'
    );
    assert.equal(second.length, 3);
    const keys = second.map((item) => item.itemKey);
    assert.equal(new Set(keys).size, keys.length);
    const third = appendOrderItemBatch(
      second,
      [
        {
          quantity: 2,
          rawText: '2 remeras negras L',
          productHint: 'remeras negras L',
          attributes: { type: 'remera', color: 'negro', size: 'L' },
        },
      ],
      'también 2 remeras negras L'
    );
    assert.equal(third.length, 3);
    const remeraL = third.find((item) => item.attributes?.size === 'L');
    assert.equal(remeraL?.quantity, 4);
    assert.equal(remeraL?.itemKey, first[0]?.itemKey);
  });
});

describe('Sin fallback agresivo a create_order', () => {
  it('un texto no reconocido no se convierte en pedido', () => {
    const parsed = parseWithRules('Pásalo a estado entregado');
    assert.notEqual(parsed.intent, 'create_order');
    assert.equal(parseWithRules('asdfgh qwerty').intent, 'unknown');
  });
});

const MACHADO_FOCUS = {
  id: 'ord-00236',
  label: '00236',
  clientName: 'Laissmachado - ig',
  status: 'pendiente',
};

const STATUS_QUERY = 'en que estado esta el pedido de machado?';

describe('Consulta explícita vs resume_context', () => {
  it('en qué estado está el pedido de Machado no dispara SÍ/NO', () => {
    const state = idleState('clarify');
    state.focusOrder = MACHADO_FOCUS;
    const parsed = parseWithRules(STATUS_QUERY, { focusOrder: MACHADO_FOCUS });
    assert.equal(parsed.intent, 'query_status');
    assert.notEqual(parsed.intent, 'create_order');
    assert.equal(hasExplicitCompleteIntent(STATUS_QUERY), true);
    assert.equal(classifyConversationSpeechAct(STATUS_QUERY, 'clarify'), 'execute_explicit');
    assert.equal(shouldAskIdleResume(STATUS_QUERY, state, parsed), false);
    assert.equal(routeResumeUtterance(STATUS_QUERY, parsed).kind, 'run_new');
  });

  it('machado resuelve al foco Laissmachado #00236', () => {
    assert.equal(personNamesLookRelated('machado', 'Laissmachado - ig'), true);
    const parsed = parseWithRules(STATUS_QUERY, { focusOrder: MACHADO_FOCUS });
    assert.equal(parsed.intent, 'query_status');
    const base = 'entities' in parsed ? parsed.entities ?? {} : {};
    const locked = lockedOrderFromFocus(MACHADO_FOCUS);
    const entities = applyOrderLock({ ...base, sourceText: STATUS_QUERY }, locked, STATUS_QUERY);
    assert.equal(entities.targetOrderId, 'ord-00236');
    assert.equal(entities.targetOrderLabel, '00236');
    assert.notEqual(parsed.conversationAction, 'cancel_current');
  });

  it('y cuánto debe? sigue el mismo pedido', () => {
    const last = {
      intent: 'query_status' as const,
      slots: {
        clientName: 'Laissmachado - ig',
        orderNumber: '00236',
        targetOrderId: 'ord-00236',
        targetOrderLabel: '00236',
      },
    };
    assert.equal(looksLikeQueryFollowUp('y cuánto debe?', last), true);
    const next = applyQueryFollowUp('y cuánto debe?', last);
    assert.equal(next.intent, 'query_status');
    assert.equal(next.slots.targetOrderId, 'ord-00236');
    assert.equal(next.slots.clientName, 'Laissmachado - ig');
    assert.doesNotMatch(String(next.slots.clientName), /cu[aá]nto/i);
  });

  it('ponelo entregado usa el mismo foco', () => {
    const parsed = parseWithRules('ponelo entregado', { focusOrder: MACHADO_FOCUS });
    assert.equal(parsed.intent, 'update_order_status');
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(entities.orderStatus, 'entregado');
    assert.equal(entities.targetOrderId, 'ord-00236');
    assert.equal(shouldAskIdleResume('ponelo entregado', idleState('clarify'), parsed), false);
  });

  it('hola sí puede pedir resume si hay pending viejo', () => {
    const parsed = parseWithRules('hola');
    assert.equal(parsed.intent, 'greeting');
    assert.equal(shouldAskIdleResume('hola', idleState('clarify'), parsed), true);
  });
});

describe('ERP: cambio de estado al confirmar SÍ', () => {
  it('erp-integration importa updateOrderStatusFromWhatsapp', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./erp-integration.ts', import.meta.url), 'utf8');
    assert.match(src, /import \{ updateOrderStatusFromWhatsapp \} from '\.\/order-status\.ts'/);
    assert.match(src, /await updateOrderStatusFromWhatsapp\(tenant, entities\)/);
  });
});
