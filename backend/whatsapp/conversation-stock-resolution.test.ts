import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWithRules } from './ai-command-parser.ts';
import { doesFillCurrentSlot, isFreshTaskUtterance } from './conversation-follow.ts';
import { resolveStockDiscountAsk } from '../utils/order-config.ts';
import {
  STOCK_RESOLUTION_INTENT,
  formatStockResolutionAsk,
  interpretStockResolutionFromText,
  splitCompoundStockUtterance,
} from './stock-resolution.ts';
import { conversationFocusAfterOperation } from './conversation-state.ts';

const STOCK_CONV = {
  awaiting: STOCK_RESOLUTION_INTENT,
  pendingIntent: STOCK_RESOLUTION_INTENT,
  originalIntent: 'update_order_status',
  pendingPrompt: '¿Descuento el stock de todo el pedido? SÍ / NO',
  knownEntities: {
    targetOrderId: 'ord-00236',
    targetOrderLabel: '00236',
    clientName: 'Laissmachado',
    orderStatus: 'entregado' as const,
  },
  focusOrder: {
    id: 'ord-00236',
    label: '00236',
    clientName: 'Laissmachado',
    status: 'pendiente',
  },
};

describe('Decisión de stock durante cambio de estado', () => {
  it('RP: sin reservas y con pendiente, solo se puede descontar el pedido completo', () => {
    const ask = resolveStockDiscountAsk({
      willConsume: true,
      blocked: false,
      canChooseScope: true,
      requiresFullStock: false,
      defaultScope: 'solo_reservado',
      totalReservado: 0,
      totalCompleto: 12,
    });
    assert.ok(ask);
    assert.equal(ask.reason, 'no_reserved_units');
    assert.deepEqual(ask.options, ['pedido_completo']);
  });

  it('RP: si se puede elegir y hay reservas, ofrece ambos alcances', () => {
    const ask = resolveStockDiscountAsk({
      willConsume: true,
      blocked: false,
      canChooseScope: true,
      requiresFullStock: false,
      defaultScope: 'solo_reservado',
      totalReservado: 4,
      totalCompleto: 12,
    });
    assert.ok(ask);
    assert.equal(ask.reason, 'choose_scope');
    assert.deepEqual(ask.options, ['solo_reservado', 'pedido_completo']);
  });

  it('RP: exigir stock completo no oculta la elección si el ERP permite elegir alcance', () => {
    const ask = resolveStockDiscountAsk({
      willConsume: true,
      blocked: false,
      canChooseScope: true,
      requiresFullStock: true,
      defaultScope: 'pedido_completo',
      totalReservado: 4,
      totalCompleto: 12,
    });
    assert.ok(ask);
    assert.equal(ask.reason, 'choose_scope');
  });

  it('RP: sin poder elegir, un estado de stock completo aplica el default sin preguntar', () => {
    const ask = resolveStockDiscountAsk({
      willConsume: true,
      blocked: false,
      canChooseScope: false,
      requiresFullStock: true,
      defaultScope: 'pedido_completo',
      totalReservado: 4,
      totalCompleto: 12,
    });
    assert.equal(ask, null);
  });

  it('RP: sin poder elegir y con reservas, aplica el default sin preguntar', () => {
    const ask = resolveStockDiscountAsk({
      willConsume: true,
      blocked: false,
      canChooseScope: false,
      requiresFullStock: false,
      defaultScope: 'solo_reservado',
      totalReservado: 4,
      totalCompleto: 12,
    });
    assert.equal(ask, null);
  });

  it('la pregunta compacta no usa el texto técnico largo del ERP', () => {
    const copy = formatStockResolutionAsk({
      reason: 'no_reserved_units',
      options: ['pedido_completo'],
      defaultScope: 'pedido_completo',
      totalReservado: 0,
      totalCompleto: 12,
    });
    assert.match(copy, /Stock del pedido/);
    assert.match(copy, /No hay unidades reservadas/);
    assert.match(copy, /SÍ/);
    assert.doesNotMatch(copy, /Revisá la preparación/);
  });

  it('"desconta el total del pedido" no es create_order si awaiting es stock_resolution', () => {
    const parsed = parseWithRules('desconta el total del pedido', STOCK_CONV);
    assert.equal(parsed.intent, 'update_order_status');
    assert.notEqual(parsed.intent, 'create_order');
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(entities.stockResolution, 'discount_full_order');
    assert.equal(entities.descuentoFisicoAlcance, 'pedido_completo');
    assert.equal(entities.productName, undefined);
    assert.equal(parsed.conversationAction, 'answer_current');
  });

  it('"todo" con awaiting stock_resolution es DISCOUNT_FULL_ORDER', () => {
    const parsed = parseWithRules('todo', STOCK_CONV);
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(parsed.intent, 'update_order_status');
    assert.equal(entities.stockResolution, 'discount_full_order');
  });

  it('"sí" responde la última pregunta de descontar todo', () => {
    const parsed = parseWithRules('sí', STOCK_CONV);
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(entities.stockResolution, 'discount_full_order');
    assert.equal(parsed.conversationAction, 'answer_current');
  });

  it('"no, dejalo como estaba" cancela y no crea un pedido', () => {
    const parsed = parseWithRules('no, dejalo como estaba', STOCK_CONV);
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(parsed.intent, 'update_order_status');
    assert.equal(entities.stockResolution, 'cancel');
    assert.equal(parsed.conversationAction, 'cancel_current');
    assert.equal(entities.productName, undefined);
  });

  it('sin awaiting, la misma frase no debe quedar como stock_resolution', () => {
    const parsed = parseWithRules('desconta el total del pedido', {
      focusOrder: STOCK_CONV.focusOrder,
    });
    assert.notEqual(
      'entities' in parsed ? parsed.entities?.stockResolution : undefined,
      'discount_full_order'
    );
  });

  it('el slot de stock_resolution se llena con la frase real y con "todo"', () => {
    const payload = { originalIntent: 'update_order_status', entities: STOCK_CONV.knownEntities };
    assert.equal(doesFillCurrentSlot('desconta el total del pedido', STOCK_RESOLUTION_INTENT, payload), true);
    assert.equal(doesFillCurrentSlot('todo', STOCK_RESOLUTION_INTENT, payload), true);
    assert.equal(doesFillCurrentSlot('no, dejalo como estaba', STOCK_RESOLUTION_INTENT, payload), true);
    assert.equal(isFreshTaskUtterance('desconta el total del pedido', STOCK_RESOLUTION_INTENT), false);
    assert.equal(isFreshTaskUtterance('todo', STOCK_RESOLUTION_INTENT), false);
  });

  it('una consulta de saldo suelta no cierra la decisión de stock', () => {
    const payload = { originalIntent: 'update_order_status', entities: STOCK_CONV.knownEntities };
    assert.equal(doesFillCurrentSlot('cuánto saldo tiene?', STOCK_RESOLUTION_INTENT, payload), false);
  });

  it('frase combinada: resuelve stock y deja la consulta de saldo', () => {
    const split = splitCompoundStockUtterance(
      'desconta todo y después decime cuánto saldo tiene'
    );
    assert.equal(interpretStockResolutionFromText(split.head).action, 'discount_full_order');
    assert.match(split.leftover, /saldo/i);
    const parsed = parseWithRules('desconta todo y después decime cuánto saldo tiene', STOCK_CONV);
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(parsed.intent, 'update_order_status');
    assert.equal(entities.stockResolution, 'discount_full_order');
  });

  it('al terminar la decisión el foco del pedido se conserva', () => {
    const patch = conversationFocusAfterOperation({
      kind: 'order',
      id: 'ord-00236',
      label: '00236',
      clientName: 'Laissmachado',
      status: 'entregado',
      at: '2026-08-28T22:00:00.000Z',
    });
    assert.equal(patch.focusOrder?.id, 'ord-00236');
    assert.equal(patch.focusOrder?.status, 'entregado');
    assert.equal(patch.activeTask, null);
  });
});
