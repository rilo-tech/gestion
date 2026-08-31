import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OPERATION_CATALOG, OPERATION_TABLE_ROWS, queryIntents, writeIntents } from './operation-catalog.ts';
import { entitiesToOperation, operationToEntities, payloadKeysFor } from './operation-payloads.ts';
import { missingRequiredFields } from './required-fields.ts';
import { parseWithRules } from './ai-command-parser.ts';
import type { WhatsappIntent } from './ai-command-parser.ts';
import { applyQueryFollowUp, looksLikeQueryFollowUp } from './query-follow.ts';
import { guessQueuedIntent, splitCurrentAndQueued, takeDualIntent } from './task-queue.ts';

const ALL_INTENTS: WhatsappIntent[] = [
  'help',
  'how_to',
  'capability_question',
  'greeting',
  'create_order',
  'create_sale',
  'create_purchase',
  'register_payment',
  'query_balance',
  'query_cash',
  'query_status',
  'query_stock',
  'register_cash',
  'create_client',
  'register_cost',
  'update_product_cost',
  'update_order_status',
  'unknown',
];

describe('cobertura de intents', () => {
  it('el catálogo cubre todos los intents del parser', () => {
    for (const intent of ALL_INTENTS) {
      assert.ok(OPERATION_CATALOG[intent], `falta ${intent} en OPERATION_CATALOG`);
    }
    assert.equal(Object.keys(OPERATION_CATALOG).length, ALL_INTENTS.length);
    assert.equal(OPERATION_TABLE_ROWS.length, ALL_INTENTS.length);
  });

  it('cada familia tiene payload discriminado (no un schema único mezclado)', () => {
    const order = entitiesToOperation('create_order', {
      clientName: 'Juan',
      items: [{ quantity: 2, rawText: 'remeras' }],
      amount: 1500,
    });
    assert.equal(order.intent, 'create_order');
    if (order.intent !== 'create_order') return;
    assert.equal(order.payload.clientName, 'Juan');
    assert.equal('cashType' in order.payload, false);
    assert.equal('purchaseLines' in order.payload, false);

    const cash = entitiesToOperation('register_cash', { amount: 500, cashType: 'egreso' });
    assert.equal(cash.intent, 'register_cash');
    if (cash.intent !== 'register_cash') return;
    assert.equal(cash.payload.amount, 500);
    assert.equal('items' in cash.payload, false);
    assert.equal('clientName' in cash.payload, false);

    const stock = entitiesToOperation('query_stock', {
      items: [{ quantity: 1, rawText: 'negras XL', attributes: { color: 'negro', size: 'XL' } }],
    });
    assert.equal(stock.intent, 'query_stock');
    if (stock.intent !== 'query_stock') return;
    assert.equal(stock.payload.color, 'negro');
    assert.equal(stock.payload.size, 'XL');
    assert.equal(payloadKeysFor('query_stock').includes('color'), true);
  });

  it('roundtrip operation ↔ entities conserva el intent', () => {
    const original = entitiesToOperation('register_payment', {
      clientName: 'Juan',
      amount: 500,
      paymentKind: 'pago',
    });
    const entities = operationToEntities(original);
    const back = entitiesToOperation('register_payment', entities);
    assert.deepEqual(back, original);
  });

  it('writes piden confirmación; queries no', () => {
    for (const intent of writeIntents()) {
      assert.equal(OPERATION_CATALOG[intent].confirmation, true, intent);
      assert.equal(OPERATION_CATALOG[intent].mutates, 'write', intent);
    }
    for (const intent of queryIntents()) {
      assert.equal(OPERATION_CATALOG[intent].confirmation, false, intent);
      assert.equal(OPERATION_CATALOG[intent].mutates, 'read', intent);
    }
  });

  it('campos obligatorios por familia', () => {
    assert.ok(missingRequiredFields('create_order', {}).some((field) => field.key === 'clientName'));
    assert.ok(missingRequiredFields('create_sale', {}).some((field) => field.key === 'amount'));
    assert.ok(missingRequiredFields('create_purchase', {}).some((field) => field.key === 'supplierName'));
    assert.ok(missingRequiredFields('register_payment', {}).some((field) => field.key === 'amount'));
    assert.ok(missingRequiredFields('register_cash', {}).some((field) => field.key === 'amount'));
    assert.ok(missingRequiredFields('create_client', {}).some((field) => field.key === 'clientName'));
    assert.ok(missingRequiredFields('update_product_cost', {}).some((field) => field.key === 'productName'));
    assert.ok(missingRequiredFields('query_balance', {}).some((field) => field.key === 'clientName'));
    assert.equal(missingRequiredFields('query_cash', {}).length, 0);
    assert.ok(missingRequiredFields('query_stock', {}).some((field) => field.key === 'productName'));
    assert.equal(
      missingRequiredFields('query_stock', { productId: 'sku-1' }).length,
      0
    );
    assert.equal(
      missingRequiredFields('query_stock', { referToFocusedProduct: true }).length,
      0
    );
    assert.equal(
      missingRequiredFields('query_stock', {
        items: [{ quantity: 1, rawText: 'negras XL', attributes: { color: 'negro', size: 'XL' } }],
      }).length,
      0
    );
    assert.equal(missingRequiredFields('help', {}).length, 0);
    assert.equal(missingRequiredFields('how_to', {}).length, 0);
    assert.equal(missingRequiredFields('capability_question', {}).length, 0);
    assert.equal(missingRequiredFields('greeting', {}).length, 0);
    assert.equal(missingRequiredFields('query_status', {}).length, 0);
  });

  it('reglas reconocen cada familia operativa', () => {
    assert.equal(parseWithRules('consultame').intent, 'help');
    assert.equal(parseWithRules('hola').intent, 'greeting');
    assert.equal(parseWithRules('pedido para Ana camiseta $1500').intent, 'create_order');
    assert.equal(parseWithRules('venta de 2 remeras a Juan $2000').intent, 'create_sale');
    assert.equal(parseWithRules('compra a proveedor Textil remito 12').intent, 'create_purchase');
    assert.equal(parseWithRules('cobré 500 a Juan').intent, 'register_payment');
    assert.equal(parseWithRules('saldo de Juan').intent, 'query_balance');
    assert.equal(parseWithRules('cuánto hay en caja').intent, 'query_cash');
    assert.equal(parseWithRules('en qué estado quedó el pedido').intent, 'query_status');
    assert.equal(parseWithRules('cuántas negras XL tengo').intent, 'query_stock');
    assert.equal(parseWithRules('egreso de caja 4015 en personal').intent, 'register_cash');
    assert.equal(parseWithRules('registrá un cliente nuevo Pedro Gomez').intent, 'create_client');
    assert.equal(parseWithRules('en el pedido nro 223 sumale al costo $200').intent, 'register_cost');
    assert.equal(parseWithRules('el costo de Taza AA es 147').intent, 'update_product_cost');
    assert.equal(parseWithRules('el pedido quedó listo').intent, 'update_order_status');
    assert.equal(
      parseWithRules(
        'Quiero registrar un pedido de 30 productos, ¿cómo te paso la info para los productos y el cliente?'
      ).intent,
      'how_to'
    );
    assert.equal(parseWithRules('puedo mandarte un pedido con 30 productos?').intent, 'capability_question');
  });
});

describe('continuidad de consultas y dual-intent', () => {
  it('y Pedro? reusa query_balance cambiando solo el cliente', () => {
    const last = { intent: 'query_balance' as const, slots: { clientName: 'Juan' } };
    assert.equal(looksLikeQueryFollowUp('y Pedro?', last), true);
    const next = applyQueryFollowUp('y Pedro?', last);
    assert.equal(next.intent, 'query_balance');
    assert.equal(next.slots.clientName, 'Pedro');
  });

  it('y L? reusa query_stock cambiando solo el talle', () => {
    const last = {
      intent: 'query_stock' as const,
      slots: { color: 'negro', size: 'XL', productHint: 'dry cool' },
    };
    assert.equal(looksLikeQueryFollowUp('y L?', last), true);
    const next = applyQueryFollowUp('y L?', last);
    assert.equal(next.slots.color, 'negro');
    assert.equal(next.slots.size, 'L');
    assert.equal(next.slots.productHint, 'dry cool');
  });

  it('500 y anotame también una venta… no descarta la segunda intención', () => {
    const split = splitCurrentAndQueued('500 y anotame también una venta de dos remeras');
    assert.ok(split);
    assert.match(split!.currentText, /500/);
    assert.match(split!.queuedRaw, /venta de dos remeras/i);
    assert.equal(guessQueuedIntent(split!.queuedRaw), 'create_sale');
    const dual = takeDualIntent('500 y anotame también una venta de dos remeras');
    assert.equal(dual.queued?.intent, 'create_sale');
    assert.equal(dual.currentText, '500');
  });
});
