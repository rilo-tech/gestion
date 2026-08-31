import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWithRules } from './ai-command-parser.ts';
import {
  applyCompletePartyFromUtterance,
  entityLookupCandidates,
  extractPartyRawFromUtterance,
  preferCompleteEntityName,
} from './entity-name.ts';
import { formatOperationSummary } from './lookups.ts';
import {
  formatOrderFinanceLines,
  looksLikeRelatedOrderPayment,
  planRelatedOrderFinance,
} from './order-finance.ts';
import { transactionViewFor } from './whatsapp-present.ts';

const LAISS_UTTERANCE =
  'Registra un pedido del cliente Laissmachado - ig un canguro XL rojo...';
const LAISS_PAID_UTTERANCE =
  'Registra un pedido del cliente Laissmachado - ig un canguro XL rojo con diseño de ceibal ya está pago $1550';

describe('TEST — preservar nombres completos de entidades', () => {
  it('conserva el candidato completo con guion y sufijo informal', () => {
    const raw = extractPartyRawFromUtterance(LAISS_UTTERANCE);
    assert.equal(raw, 'Laissmachado - ig');
  });

  it('no trunca por paréntesis, @ ni números', () => {
    assert.equal(
      extractPartyRawFromUtterance('pedido del cliente Juan Perez (taller) un buzo negro'),
      'Juan Perez (taller)'
    );
    assert.equal(
      extractPartyRawFromUtterance('registrá un pedido al cliente Maria @tienda una remera'),
      'Maria @tienda'
    );
    assert.equal(
      extractPartyRawFromUtterance('pedido para Ana 23 un canguro XL'),
      'Ana 23'
    );
  });

  it('parseWithRules deja client.raw / spokenClientName completo', () => {
    const parsed = parseWithRules(LAISS_UTTERANCE);
    assert.equal(parsed.intent, 'create_order');
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(entities.spokenClientName, 'Laissmachado - ig');
    assert.equal(entities.clientName, 'Laissmachado - ig');
  });

  it('busca primero el texto original y recién después variantes', () => {
    const candidates = entityLookupCandidates('Laissmachado - ig');
    assert.equal(candidates[0], 'Laissmachado - ig');
    assert.ok(candidates.includes('Laissmachado'));
    assert.ok(candidates.findIndex((row) => row === 'Laissmachado') > 0);

    const parenthetical = entityLookupCandidates('Juan Perez (taller)');
    assert.equal(parenthetical[0], 'Juan Perez (taller)');
    assert.ok(parenthetical.includes('Juan Perez'));
  });

  it('si Gemini trunca, el utterance completa el raw sin perder el original', () => {
    const entities = {
      clientName: 'Laissmachado',
      spokenClientName: 'Laissmachado',
    };
    applyCompletePartyFromUtterance(LAISS_UTTERANCE, entities);
    assert.equal(entities.spokenClientName, 'Laissmachado - ig');
    assert.equal(entities.clientName, 'Laissmachado - ig');
    assert.equal(preferCompleteEntityName('Laissmachado', 'Laissmachado - ig'), 'Laissmachado - ig');
  });
});

describe('TEST — pago incluido en creación de pedido', () => {
  it('detecta pago relacionado por familia semántica, no por una frase fija', () => {
    assert.equal(looksLikeRelatedOrderPayment('ya está pago $1550'), true);
    assert.equal(looksLikeRelatedOrderPayment('pagado $2000'), true);
    assert.equal(looksLikeRelatedOrderPayment('el pedido ya pagó'), true);
    assert.equal(looksLikeRelatedOrderPayment('quedó cobrado'), true);
    assert.equal(looksLikeRelatedOrderPayment('pedido para Ana camiseta $1500 forma de pago efectivo'), false);
  });

  it('crea pedido + cobro asociado: total 1550, cobro 1550, saldo 0', () => {
    const parsed = parseWithRules(LAISS_PAID_UTTERANCE);
    assert.equal(parsed.intent, 'create_order');
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    assert.equal(entities.clientName, 'Laissmachado - ig');
    assert.equal(entities.amount, 1550);
    assert.equal(entities.paid, true);

    const finance = planRelatedOrderFinance({
      amount: entities.amount,
      seniaAmount: entities.seniaAmount,
      paid: entities.paid,
      sourceText: LAISS_PAID_UTTERANCE,
    });
    assert.equal(finance.kind, 'full');
    assert.equal(finance.total, 1550);
    assert.equal(finance.cobro, 1550);
    assert.equal(finance.saldo, 0);
  });

  it('el resumen previo a confirmación muestra Venta, Pago y saldo', () => {
    const parsed = parseWithRules(LAISS_PAID_UTTERANCE);
    const entities = {
      ...('entities' in parsed ? parsed.entities ?? {} : {}),
      sourceText: LAISS_PAID_UTTERANCE,
      items: [{ quantity: 1, rawText: 'canguro XL rojo', productName: 'canguro XL rojo' }],
    };
    const summary = formatOperationSummary('create_order', entities);
    const view = transactionViewFor('create_order', entities);
    const presented = [summary, view?.footer?.join('\n') ?? '', formatOrderFinanceLines(
      planRelatedOrderFinance({
        amount: 1550,
        paid: true,
        sourceText: LAISS_PAID_UTTERANCE,
      })
    ).join('\n')].join('\n');

    for (const text of [summary, presented]) {
      assert.match(text, /Venta:.*\$1\.550/);
      assert.match(text, /Pago:.*\$1\.550/);
      assert.match(text, /saldo \$0/);
    }
    assert.ok(/Pago:/.test(summary), 'no alcanza con Monto: $1550; tiene que verse el cobro interpretado');
  });
});
