import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  catalogQueryForItem,
  decideMatchAction,
  looksLikeConcatenatedItems,
  parseLineItems,
  splitConcatenatedProductText,
} from './conversation-contract.ts';
import {
  applyFollowUpToEntities,
  applyItemCorrection,
  catalogQueriesForEntities,
  interpretFollowUp,
  parseChoiceFromText,
  coalesceOrderItems,
  normalizeOrderLineItems,
  looksLikeAddAnotherItem,
} from './turn-interpreter.ts';
import {
  applyLanguageMemory,
  extractTermMapping,
  isLearnableExpression,
} from './language-memory.ts';
import type { WhatsappCommandEntities } from './ai-command-parser.ts';

const yovanaUtterance =
  'registrame un pedido de 1 camiseta dry coll talle L blanca y 1 camiseta dry coll talle XL al cliente Yovana 098828757';

describe('RiloBot conversational contract', () => {
  it('Caso A: una frase con 2 productos nunca se busca concatenada', () => {
    const items = parseLineItems([
      {
        quantity: 1,
        rawText: 'camiseta dry coll talle L blanca',
        productHint: 'camiseta dry cool',
        attributes: { type: 'camiseta', fabric: 'dry cool', size: 'L', color: 'blanco' },
      },
      {
        quantity: 1,
        rawText: 'camiseta dry coll talle XL',
        productHint: 'camiseta dry cool',
        attributes: { type: 'camiseta', fabric: 'dry cool', size: 'XL' },
      },
    ]);
    assert.equal(items.length, 2);
    const queries = items.map((item) => catalogQueryForItem(item));
    for (const query of queries) {
      assert.equal(looksLikeConcatenatedItems(query), false);
      assert.doesNotMatch(query, / y 1 /i);
    }
    assert.match(queries[0]!, /L/i);
    assert.match(queries[1]!, /XL/i);

    const fallback = splitConcatenatedProductText(
      '1 camiseta dry coll talle L blanca y 1 camiseta dry coll talle XL'
    );
    assert.equal(fallback.length, 2);
    const fromEntities = catalogQueriesForEntities({
      productName: '1 camiseta dry coll talle L blanca y 1 camiseta dry coll talle XL',
      sourceText: yovanaUtterance,
    });
    assert.equal(fromEntities.length, 2);
    assert.equal(fromEntities.some((query) => looksLikeConcatenatedItems(query)), false);
  });

  it('Caso B: negra solo pinta el segundo ítem', () => {
    const collected: WhatsappCommandEntities = {
      clientName: 'Yovana',
      items: [
        {
          quantity: 1,
          rawText: 'camiseta dry cool talle L blanca',
          productName: 'Camiseta Dry Cool blanca L',
          attributes: { color: 'blanco', size: 'L' },
        },
        {
          quantity: 1,
          rawText: 'camiseta dry cool talle XL',
          productHint: 'camiseta dry cool',
          attributes: { size: 'XL' },
        },
      ],
    };
    const next = applyFollowUpToEntities(collected, 'negra', {
      type: 'field',
      field: 'itemColor',
      itemIndex: 1,
    });
    assert.equal(next.items?.[0]?.attributes?.color, 'blanco');
    assert.equal(next.items?.[0]?.productName, 'Camiseta Dry Cool blanca L');
    assert.equal(next.items?.[1]?.attributes?.color, 'negro');
  });

  it('Caso C: negra y para el viernes completa color y fecha', () => {
    const collected: WhatsappCommandEntities = {
      clientName: 'Yovana',
      items: [
        { quantity: 1, rawText: 'dry cool L blanca', attributes: { color: 'blanco', size: 'L' } },
        { quantity: 1, rawText: 'dry cool XL', attributes: { size: 'XL' } },
      ],
    };
    const next = applyFollowUpToEntities(collected, 'negra y para el viernes', {
      type: 'field',
      field: 'itemColor',
      itemIndex: 1,
    });
    assert.equal(next.items?.[0]?.attributes?.color, 'blanco');
    assert.equal(next.items?.[1]?.attributes?.color, 'negro');
    assert.ok(next.deliveryDate, 'debe haber interpretado viernes como fecha');
  });

  it('Caso D: el primero elige la opción 1', () => {
    const choice = parseChoiceFromText('el primero');
    assert.equal(choice.index, 1);
    const numbered = parseChoiceFromText('1');
    assert.equal(numbered.index, 1);
  });

  it('Caso E: sí confirma y la expresión se puede aprender', () => {
    const follow = interpretFollowUp('sí', { type: 'confirmation' });
    assert.equal(follow.conversationAction, 'confirm_current');
    const mapping = extractTermMapping('dry coll', 'Dry Cool');
    assert.ok(mapping);
    assert.equal(mapping?.userExpression.includes('coll') || mapping?.userExpression === 'dry coll', true);
    assert.equal(isLearnableExpression('dry coll', 'dry cool'), true);
    assert.equal(isLearnableExpression('500', 'precio'), false);
  });

  it('Caso F: memoria confirmada ayuda a dry coll → dry cool', () => {
    const rewritten = applyLanguageMemory('agregame una dry coll XL', {
      aliases: [
        {
          userExpression: 'dry coll',
          resolvedMeaning: 'dry cool',
          entityType: 'product_term',
          confidence: 0.98,
          confirmations: 1,
          lastUsedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });
    assert.match(rewritten, /dry cool/i);
    assert.doesNotMatch(rewritten, /dry coll/i);
  });

  it('Caso G: no, la segunda era L solo cambia el talle 2', () => {
    const items = [
      { quantity: 1, rawText: 'dry cool M blanca', attributes: { size: 'M', color: 'blanco' } },
      { quantity: 1, rawText: 'dry cool XL negra', attributes: { size: 'XL', color: 'negro' } },
    ];
    const result = applyItemCorrection(items, 'no, la segunda era L');
    assert.equal(result.items[0]?.attributes?.size, 'M');
    assert.equal(result.items[0]?.attributes?.color, 'blanco');
    assert.equal(result.items[1]?.attributes?.size, 'L');
    assert.equal(result.items[1]?.attributes?.color, 'negro');
  });

  it('Caso H: sacá la primera elimina solo el ítem 1', () => {
    const items = [
      { quantity: 1, rawText: 'primera' },
      { quantity: 2, rawText: 'segunda' },
    ];
    const result = applyItemCorrection(items, 'sacá la primera');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.rawText, 'segunda');
    assert.equal(result.items[0]?.quantity, 2);
  });

  it('Caso I: ese no apunta al candidato mostrado', () => {
    const choice = parseChoiceFromText('ese no');
    assert.equal(choice.reject, true);
    assert.equal(choice.index, 1);
    const follow = interpretFollowUp('ese no', { type: 'product_choice' });
    assert.equal(follow.conversationAction, 'correct_current');
  });

  it('Caso J: mensaje incomprensible no inventa acción', () => {
    const follow = interpretFollowUp('asdfgh qwerty', { type: 'field', field: 'itemColor' });
    assert.equal(follow.requiresClarification, true);
    assert.notEqual(follow.conversationAction, 'new_task');
    assert.notEqual(follow.intent === 'unknown' || follow.requiresClarification, false);
  });

  it('confianza combinada no avanza con match débil', () => {
    assert.equal(decideMatchAction({ geminiConfidence: 0.99, catalogScore: 20, unique: false }), 'ask');
    assert.equal(decideMatchAction({ geminiConfidence: 0.5, catalogScore: 98, unique: true }), 'advance');
  });

  it('una sola mención no duplica al resolver el SKU', () => {
    const spoken = {
      quantity: 1,
      rawText: 'un canguro XL rojo',
      productHint: 'canguro',
      attributes: { type: 'canguro', size: 'XL', color: 'rojo' },
    };
    const resolved = {
      quantity: 1,
      rawText: 'Canguro felpa Rojo XL',
      productHint: 'canguro felpa rojo XL',
      productName: 'Canguro felpa Rojo XL',
      productId: 'sku-1',
      attributes: { type: 'canguro', fabric: 'felpa', size: 'XL', color: 'rojo' },
    };
    const collected: WhatsappCommandEntities = {
      clientName: 'Laissmachado - ig',
      items: [spoken],
      sourceText: 'Registra un pedido del cliente Laissmachado - ig un canguro XL rojo',
    };
    const next = applyFollowUpToEntities(collected, 'hoy', { type: 'field', field: 'deliveryDate' }, {
      conversationAction: 'continue_current',
      items: [resolved],
    });
    assert.equal(next.items?.length, 1);
    assert.equal(next.items?.[0]?.productId, 'sku-1');
    assert.match(String(next.items?.[0]?.productName), /Canguro felpa Rojo XL/i);
    assert.equal(next.items?.[0]?.quantity, 1);

    const coalesced = coalesceOrderItems([spoken], [spoken, resolved], collected.sourceText);
    assert.equal(coalesced.length, 1);
    assert.equal(coalesced[0]?.quantity, 1);
    assert.equal(coalesced[0]?.productId, 'sku-1');
    assert.match(String(coalesced[0]?.itemKey), /un canguro xl rojo/i);
  });

  it('2 canguros rojo XL queda un renglón con quantity 2', () => {
    const dupes = [
      { quantity: 1, rawText: 'canguro rojo XL', attributes: { type: 'canguro', color: 'rojo', size: 'XL' } },
      { quantity: 1, rawText: 'canguro rojo XL', productName: 'Canguro felpa Rojo XL', attributes: { type: 'canguro', color: 'rojo', size: 'XL' } },
    ];
    const merged = normalizeOrderLineItems(dupes, '2 canguros rojo XL');
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.quantity, 2);

    const already = normalizeOrderLineItems(
      [{ quantity: 2, rawText: '2 canguros rojo XL', attributes: { type: 'canguro', color: 'rojo', size: 'XL' } }],
      '2 canguros rojo XL'
    );
    assert.equal(already.length, 1);
    assert.equal(already[0]?.quantity, 2);

    const lifted = normalizeOrderLineItems(
      [{ quantity: 1, rawText: 'canguros rojo XL', attributes: { type: 'canguro', color: 'rojo', size: 'XL' } }],
      '2 canguros rojo XL'
    );
    assert.equal(lifted.length, 1);
    assert.equal(lifted[0]?.quantity, 2);

    const twoMentions = normalizeOrderLineItems(
      [
        { quantity: 1, rawText: 'un canguro rojo XL', attributes: { type: 'canguro', color: 'rojo', size: 'XL' } },
        { quantity: 1, rawText: 'otro canguro rojo XL', attributes: { type: 'canguro', color: 'rojo', size: 'XL' } },
      ],
      'un canguro rojo XL y otro canguro rojo XL'
    );
    assert.equal(twoMentions.length, 1);
    assert.equal(twoMentions[0]?.quantity, 2);
  });

  it('un canguro y una camiseta no se fusionan', () => {
    const items = normalizeOrderLineItems(
      [
        { quantity: 1, rawText: 'canguro rojo XL', attributes: { type: 'canguro', color: 'rojo', size: 'XL' } },
        { quantity: 1, rawText: 'camiseta blanca L', attributes: { type: 'camiseta', color: 'blanco', size: 'L' } },
      ],
      'un canguro rojo XL y una camiseta blanca L'
    );
    assert.equal(items.length, 2);
  });

  it('cambialo a negro corrige el único ítem y no agrega otro', () => {
    const collected: WhatsappCommandEntities = {
      items: [
        {
          quantity: 1,
          rawText: 'canguro rojo XL',
          productName: 'Canguro felpa Rojo XL',
          productId: 'sku-red',
          productLocked: true,
          attributes: { type: 'canguro', color: 'rojo', size: 'XL' },
        },
      ],
    };
    const next = applyFollowUpToEntities(collected, 'cambialo a negro', { type: 'field' }, {
      conversationAction: 'correct_current',
      items: [
        {
          quantity: 1,
          rawText: 'canguro negro XL',
          productName: 'Canguro felpa Negro XL',
          attributes: { type: 'canguro', color: 'negro', size: 'XL' },
        },
      ],
    });
    assert.equal(next.items?.length, 1);
    assert.equal(next.items?.[0]?.attributes?.color, 'negro');
    assert.equal(looksLikeAddAnotherItem('cambialo a negro'), false);
    assert.equal(looksLikeAddAnotherItem('y agregale otro XL negro'), true);
  });

  it('agregale otro XL negro sí suma un renglón', () => {
    const collected: WhatsappCommandEntities = {
      items: [
        {
          quantity: 1,
          rawText: 'canguro rojo XL',
          attributes: { type: 'canguro', color: 'rojo', size: 'XL' },
        },
      ],
    };
    const next = applyFollowUpToEntities(collected, 'y agregale otro XL negro', undefined, {
      conversationAction: 'continue_current',
      items: [
        {
          quantity: 1,
          rawText: 'canguro negro XL',
          attributes: { type: 'canguro', color: 'negro', size: 'XL' },
        },
      ],
    });
    assert.equal(next.items?.length, 2);
  });
});
