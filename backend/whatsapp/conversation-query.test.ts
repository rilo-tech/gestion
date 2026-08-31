import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASK_STOCK_PRODUCT,
  focusProductsFromOrderItems,
  presentOrderQuery,
  presentStockQuery,
  uniqueFocusProduct,
} from './conversation-query.ts';
import { missingRequiredFields } from './required-fields.ts';
import { turnInterpretationToParsed, type TurnInterpretation } from './turn-interpretation.ts';
import { conversationFocusAfterOperation } from './conversation-state.ts';

const FOCUS = {
  id: 'ord-00236',
  label: '00236',
  clientName: 'Laissmachado',
  status: 'entregado',
};

const PRODUCT = {
  id: 'sku-canguro-rojo-xl',
  name: 'Canguro felpa Rojo XL',
  locked: true,
  attributes: { type: 'canguro', color: 'rojo', size: 'XL' },
};

describe('Presenter de consultas', () => {
  it('query_stock muestra solo el producto y el stock del ERP', () => {
    const reply = presentStockQuery({ productName: 'Canguro felpa Rojo XL', stock: -1 });
    assert.equal(reply, '*Canguro felpa Rojo XL*\nStock actual: *-1 unidad*');
    assert.doesNotMatch(reply, /Pedido/);
    assert.doesNotMatch(reply, /Cliente/);
    assert.doesNotMatch(reply, /Saldo/);
    assert.doesNotMatch(reply, /Total/);
    assert.doesNotMatch(reply, /Entrega/);
  });

  it('verify_stock confirma el valor real del ERP', () => {
    assert.equal(
      presentStockQuery({ productName: 'Canguro felpa Rojo XL', stock: -1, expectedValue: -1 }),
      'Sí. El stock actual es *-1 unidad*.'
    );
    assert.equal(
      presentStockQuery({ productName: 'Canguro felpa Rojo XL', stock: 4, expectedValue: -1 }),
      'No. El stock actual es *4 unidades*.'
    );
  });

  it('query_status / balance no dumpan el pedido completo', () => {
    const status = presentOrderQuery({
      metric: 'status',
      label: '00236',
      clientName: 'Laissmachado',
      statusLabel: 'Entregado',
      total: 1550,
      saldo: 0,
    });
    assert.match(status, /Estado: \*Entregado\*/);
    assert.doesNotMatch(status, /Cliente/);
    assert.doesNotMatch(status, /Total/);
    const balance = presentOrderQuery({
      metric: 'balance',
      label: '00236',
      saldo: 0,
      total: 1550,
    });
    assert.match(balance, /Saldo: \*\$0\*/);
    assert.doesNotMatch(balance, /Total/);
  });
});

describe('Foco de producto', () => {
  it('un ítem del pedido queda como focused_product', () => {
    const products = focusProductsFromOrderItems([
      { stockItemId: 'sku-canguro-rojo-xl', nombre: 'Canguro felpa Rojo XL', color: 'Rojo', talle: 'XL' },
    ]);
    assert.equal(uniqueFocusProduct(products)?.id, 'sku-canguro-rojo-xl');
    assert.equal(uniqueFocusProduct(products)?.name, 'Canguro felpa Rojo XL');
  });

  it('completar el mismo pedido conserva el producto en foco', () => {
    const created = conversationFocusAfterOperation(
      {
        kind: 'order',
        id: 'ord-00236',
        label: '00236',
        clientName: 'Laissmachado',
        status: 'pendiente',
        productId: 'sku-canguro-rojo-xl',
        productName: 'Canguro felpa Rojo XL',
        at: '2026-08-29T15:00:00.000Z',
      },
      { focusOrder: null, focusEntities: {} }
    );
    const delivered = conversationFocusAfterOperation(
      {
        kind: 'order',
        id: 'ord-00236',
        label: '00236',
        clientName: 'Laissmachado',
        status: 'entregado',
        at: '2026-08-29T15:10:00.000Z',
      },
      created
    );
    assert.equal(delivered.focusEntities?.product?.id, 'sku-canguro-rojo-xl');
    assert.equal(delivered.focusEntities?.product?.name, 'Canguro felpa Rojo XL');
  });
});

describe('Caso real: stock del producto en foco', () => {
  const conversation = {
    focusOrder: FOCUS,
    focusEntities: { product: PRODUCT, order: { id: FOCUS.id, label: FOCUS.label, locked: true } },
  };

  it('Cómo quedó ese producto en el stock -1? → query_stock focused_product, no el pedido', () => {
    const interpretation: TurnInterpretation = {
      intent: 'query_stock',
      confidence: 0.93,
      conversationAction: 'new_task',
      rawMessage: 'Cómo quedó ese producto en el stock -1?',
      targetReference: { type: 'focused_product' },
      query: { metric: 'stock', expectedValue: -1 },
    };
    const parsed = turnInterpretationToParsed(interpretation, conversation);
    assert.equal(parsed.intent, 'query_stock');
    assert.notEqual(parsed.intent, 'query_status');
    assert.ok('entities' in parsed);
    assert.equal(parsed.entities?.referToFocusedProduct, true);
    assert.equal(parsed.entities?.productId, 'sku-canguro-rojo-xl');
    assert.equal(parsed.entities?.productName, 'Canguro felpa Rojo XL');
    assert.equal(parsed.entities?.targetOrderId, undefined);
    assert.equal(parsed.entities?.queryExpectedValue, -1);
    const reply = presentStockQuery({
      productName: parsed.entities?.productName || '',
      stock: -1,
    });
    assert.equal(reply, '*Canguro felpa Rojo XL*\nStock actual: *-1 unidad*');
  });

  it('frases de follow-up de stock usan el mismo contrato, no regex', () => {
    const phrases = [
      'cómo quedó ese producto en stock?',
      'cuánto quedó?',
      'y de stock?',
      'cuántos quedan?',
      'ese quedó en -1?',
      'cómo quedó el canguro?',
      'cuánto tengo de ese?',
    ];
    for (const rawMessage of phrases) {
      const verify = /[-]?\d/.test(rawMessage);
      const interpretation: TurnInterpretation = {
        intent: 'query_stock',
        confidence: 0.9,
        conversationAction: 'new_task',
        rawMessage,
        targetReference: 'focused_product',
        query: verify ? { metric: 'verify', expectedValue: -1 } : { metric: 'stock' },
      };
      const parsed = turnInterpretationToParsed(interpretation, conversation);
      assert.equal(parsed.intent, 'query_stock', rawMessage);
      assert.equal('entities' in parsed && parsed.entities?.productId, 'sku-canguro-rojo-xl', rawMessage);
      assert.equal('entities' in parsed && parsed.entities?.targetOrderId, undefined, rawMessage);
    }
  });

  it('y los XL negros? overlaya atributos sobre el producto en foco', () => {
    const interpretation: TurnInterpretation = {
      intent: 'query_stock',
      confidence: 0.9,
      conversationAction: 'new_task',
      rawMessage: 'y los XL negros?',
      targetReference: 'focused_product',
      query: { metric: 'stock' },
      items: [
        {
          quantity: 1,
          rawText: 'XL negros',
          itemKey: 'item:1',
          attributes: { color: 'negro', size: 'XL' },
        },
      ],
    };
    const parsed = turnInterpretationToParsed(interpretation, conversation);
    assert.equal(parsed.intent, 'query_stock');
    assert.ok('entities' in parsed);
    assert.equal(parsed.entities?.productId, undefined);
    assert.equal(parsed.entities?.items?.[0]?.attributes?.color, 'negro');
    assert.equal(parsed.entities?.items?.[0]?.attributes?.size, 'XL');
    assert.match(String(parsed.entities?.items?.[0]?.productHint ?? ''), /canguro/i);
  });

  it('sin producto en foco no inventa SKU', () => {
    const interpretation: TurnInterpretation = {
      intent: 'query_stock',
      confidence: 0.88,
      conversationAction: 'new_task',
      rawMessage: 'cuánto stock tiene?',
      query: { metric: 'stock' },
      missingFields: ['product'],
    };
    const parsed = turnInterpretationToParsed(interpretation, {});
    assert.equal(parsed.intent, 'query_stock');
    assert.ok('entities' in parsed);
    assert.equal(parsed.entities?.productId, undefined);
    assert.equal(parsed.entities?.productName, undefined);
    assert.equal(parsed.entities?.referToFocusedProduct, undefined);
    assert.ok(missingRequiredFields('query_stock', parsed.entities ?? {}).some((field) => field.key === 'productName'));
    assert.equal(ASK_STOCK_PRODUCT, '¿De qué producto querés consultar el stock?');
  });
});
