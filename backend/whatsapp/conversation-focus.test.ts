import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWithRules, looksLikeOrderStatusUpdate } from './ai-command-parser.ts';
import { conversationFocusAfterOperation } from './conversation-state.ts';
import {
  applyOrderLock,
  isExplicitOrderSwitch,
  lockedOrderFromFocus,
  shouldUseLockedOrder,
  type LockedOrderEntity,
} from './order-lock.ts';
import { extractQueryClientFromText, formatOperationSummary } from './lookups.ts';

const FOCUS = {
  id: 'ord-00245',
  label: '00245',
  clientName: 'Laissmachado - ig',
  status: 'pendiente',
};

const LOCKED: LockedOrderEntity = {
  kind: 'order',
  id: FOCUS.id,
  label: FOCUS.label,
  clientName: FOCUS.clientName,
  resolved: true,
  active: true,
};

function statusFrom(text: string) {
  const parsed = parseWithRules(text, { focusOrder: FOCUS });
  const base = 'entities' in parsed ? parsed.entities ?? {} : {};
  const entities = applyOrderLock({ ...base, sourceText: text }, LOCKED, text);
  return { parsed, entities };
}

describe('Foco conversacional vs tarea completada', () => {
  it('completar create_order cierra activeTask y deja el pedido en foco', () => {
    const patch = conversationFocusAfterOperation(
      {
        kind: 'order',
        id: 'ord-00245',
        label: '00245',
        clientName: 'Laissmachado - ig',
        clientId: 'cli-1',
        status: 'pendiente',
        amount: 1550,
        at: '2026-08-28T21:00:00.000Z',
      },
      {
        focusOrder: null,
        focusEntities: {},
      }
    );
    assert.equal(patch.activeTask, null);
    assert.equal(patch.pendingIntent, null);
    assert.equal(patch.pendingPrompt, null);
    assert.equal(patch.operationPlan, null);
    assert.equal(patch.lastOperation?.kind, 'order');
    assert.equal(patch.lastOperation?.id, 'ord-00245');
    assert.equal(patch.focusOrder?.id, 'ord-00245');
    assert.equal(patch.focusOrder?.label, '00245');
    assert.equal(patch.focusOrder?.clientName, 'Laissmachado - ig');
    assert.equal(patch.focusOrder?.status, 'pendiente');
    assert.equal(patch.focusEntities?.order?.id, 'ord-00245');
    assert.equal(patch.focusEntities?.client?.name, 'Laissmachado - ig');
  });

  it('un cobro no borra el pedido en foco', () => {
    const previous = conversationFocusAfterOperation({
      kind: 'order',
      id: 'ord-00245',
      label: '00245',
      clientName: 'Laissmachado - ig',
      status: 'pendiente',
      at: '2026-08-28T21:00:00.000Z',
    });
    const afterPay = conversationFocusAfterOperation(
      {
        kind: 'payment',
        id: 'cli-1',
        clientName: 'Laissmachado - ig',
        amount: 1550,
        at: '2026-08-28T21:01:00.000Z',
      },
      previous
    );
    assert.equal(afterPay.focusOrder?.id, 'ord-00245');
    assert.equal(afterPay.lastOperation?.kind, 'payment');
    assert.equal(afterPay.activeTask, null);
  });

  it('cambiar estado actualiza el mismo pedido en foco', () => {
    const created = conversationFocusAfterOperation({
      kind: 'order',
      id: 'ord-00245',
      label: '00245',
      clientName: 'Laissmachado - ig',
      status: 'pendiente',
      at: '2026-08-28T21:00:00.000Z',
    });
    const updated = conversationFocusAfterOperation(
      {
        kind: 'order',
        id: 'ord-00245',
        label: '00245',
        clientName: 'Laissmachado - ig',
        status: 'entregado',
        at: '2026-08-28T21:02:00.000Z',
      },
      created
    );
    assert.equal(updated.focusOrder?.id, 'ord-00245');
    assert.equal(updated.focusOrder?.status, 'entregado');
  });
});

describe('CASO producción: move el pedido a estado entregado', () => {
  const text = 'move el pedido a estado entregado';

  it('no es create_order ni un producto', () => {
    assert.equal(looksLikeOrderStatusUpdate(text), true);
    assert.equal(extractQueryClientFromText(text), null);
    assert.equal(isExplicitOrderSwitch(text, {}, LOCKED), false);
    assert.equal(shouldUseLockedOrder(text, {}, LOCKED), true);
    const { parsed, entities } = statusFrom(text);
    assert.equal(parsed.intent, 'update_order_status');
    assert.equal(entities.orderStatus, 'entregado');
    assert.equal(entities.targetOrderId, 'ord-00245');
    assert.equal(entities.clientName, 'Laissmachado - ig');
    assert.equal(entities.productName, undefined);
    assert.equal(entities.items, undefined);
    const summary = formatOperationSummary('update_order_status', {
      ...entities,
      targetOrderLabel: '00245',
      orderStatusLabel: 'Entregado',
      targetOrderEstadoLabel: 'Pendiente',
    });
    assert.match(summary, /#00245/);
    assert.match(summary, /Entregado/);
    assert.doesNotMatch(summary, /move el entregado/i);
  });

  it('variantes naturales usan el mismo pedido en foco', () => {
    const phrases = [
      'movelo a entregado',
      'pone el pedido entregado',
      'Pásalo a estado entregado',
      'Pasalo a estado entregado',
      'pasalo a entregado',
      'Pásalo a estado entregado',
      'marcalo entregado',
      'dejalo listo',
      'ahora ponelo listo',
      'cambiale el estado a listo',
      'el pedido que hicimos recién ponelo entregado',
    ];
    for (const phrase of phrases) {
      assert.equal(looksLikeOrderStatusUpdate(phrase), true, phrase);
      const { parsed, entities } = statusFrom(phrase);
      assert.equal(parsed.intent, 'update_order_status', phrase);
      assert.equal(entities.targetOrderId, 'ord-00245', phrase);
      assert.notEqual(parsed.intent, 'create_order', phrase);
    }
  });
});

describe('Referencia explícita nueva gana al foco', () => {
  it('el de Juan no reutiliza #00245', () => {
    const text = 'no, en realidad el de Juan ponelo entregado';
    assert.match(String(extractQueryClientFromText(text)), /Juan/i);
    const { parsed, entities } = statusFrom(text);
    assert.equal(parsed.intent, 'update_order_status');
    assert.equal(isExplicitOrderSwitch(text, entities, LOCKED), true);
    assert.equal(shouldUseLockedOrder(text, entities, LOCKED), false);
    const locked = applyOrderLock(entities, LOCKED, text);
    assert.notEqual(locked.targetOrderId, 'ord-00245');
  });

  it('buscame el pedido de Pedro suelta el foco', () => {
    const text = 'buscame el pedido de Pedro';
    const parsed = parseWithRules(text, { focusOrder: FOCUS });
    const base = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(shouldUseLockedOrder(text, base, LOCKED), false);
    assert.equal(lockedOrderFromFocus(FOCUS)?.id, 'ord-00245');
  });
});
