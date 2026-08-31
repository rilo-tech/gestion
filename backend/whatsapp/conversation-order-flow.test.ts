import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWithRules, extractExplicitRequestedStatus } from './ai-command-parser.ts';
import { ensureOrderItems } from './turn-interpreter.ts';
import { classifyConfirmReply } from './turn-interpreter.ts';
import {
  extractNotesHintFromText,
  parseSpokenExtraCostAnswer,
  extractExtraCostsFromText,
  extractExtraCostProductHint,
  resolveExtraCostTargetIndex,
  needsExtraCostItemAsk,
  sanitizeOrderNotes,
} from './lookups.ts';
import {
  planRelatedOrderFinance,
  planOrderEconomics,
  shouldAskOrderExtraCosts,
  ORDER_EXTRA_COST_ASK,
} from './order-finance.ts';
import { businessAllowsOrderExtraCosts } from '../utils/order-config.ts';
import {
  assertNoUndefinedDeep,
  findUndefinedPaths,
  toFirestoreOrder,
  toFirestoreOrderItem,
} from './firestore-mappers.ts';
import { presentOrderCollecting, presentOrderConfirm } from './whatsapp-present.ts';

const LAISS =
  'Registra un pedido del cliente Laissmachado - ig un canguro XL rojo con diseño de ceibal ya esta pago $1550';

const PAID_LISTO =
  'registrame un pedido de un canguro rojo XL por $1550, ya está pago y ponelo listo';

const PAID_ONLY = 'registrame un pedido de un canguro rojo XL por $1550, ya está pago';

function entitiesOf(text: string) {
  const parsed = parseWithRules(text);
  assert.equal(parsed.intent, 'create_order');
  const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
  ensureOrderItems(entities);
  return entities;
}

describe('TEST — pedido: descripción, pago, estado, extras y Firestore', () => {
  it('28 extraCostsEnabled=false: no pregunta extras; descripción Ceibal; fecha null; pago 1550; sin estado', () => {
    const entities = entitiesOf(LAISS);
    assert.equal(entities.items?.length, 1);
    assert.equal(sanitizeOrderNotes(entities.notes) || extractNotesHintFromText(LAISS), 'Ceibal');
    assert.doesNotMatch(String(entities.notes ?? ''), /pago|1550/i);
    assert.equal(entities.amount, 1550);
    assert.equal(entities.paid, true);
    assert.equal(entities.deliveryDate, undefined);
    assert.equal(entities.requestedStatus, undefined);
    assert.equal(entities.orderStatus, undefined);

    const finance = planRelatedOrderFinance({
      amount: entities.amount,
      extraCosts: entities.extraCosts,
      collectionAmount: entities.collectionAmount,
      paid: entities.paid,
      sourceText: LAISS,
    });
    assert.equal(finance.total, 1550);
    assert.equal(finance.cobro, 1550);
    assert.equal(finance.saldo, 0);

    assert.equal(businessAllowsOrderExtraCosts({ costosPersonalizacionDetallados: false }), false);
    assert.equal(
      shouldAskOrderExtraCosts({ extraCostsEnabled: false, extraCosts: entities.extraCosts }),
      false
    );
    const card = presentOrderCollecting(entities, '📅 ¿Para qué fecha es la entrega?');
    assert.doesNotMatch(card, /costo extra/i);
    assert.match(card, /Diseño: Ceibal/);
    assert.doesNotMatch(card, /Estado:/);
  });

  it('29 extraCostsEnabled=true: una sola pregunta de costo extra, no SÍ/NO', () => {
    assert.equal(businessAllowsOrderExtraCosts({ costosPersonalizacionDetallados: true }), true);
    assert.equal(businessAllowsOrderExtraCosts({}), true);
    const entities = entitiesOf(LAISS);
    assert.equal(
      shouldAskOrderExtraCosts({ extraCostsEnabled: true, extraCostsAsked: false, extraCosts: [] }),
      true
    );
    const ask = presentOrderCollecting(
      { ...entities, deliveryDate: '2026-08-28' },
      ORDER_EXTRA_COST_ASK
    );
    assert.match(ask, /Indicame el costo extra y el importe, o \*NO\*/);
    assert.match(ask, /Entrega:/);
    assert.match(ask, /Venta: \$1\.550/);
    assert.doesNotMatch(ask, /Querés agregar/);
    assert.doesNotMatch(ask, /SÍ \/ NO/);
    assert.equal(
      shouldAskOrderExtraCosts({ extraCostsEnabled: true, extraCostsAsked: true }),
      false
    );
    const confirm = presentOrderConfirm({
      ...entities,
      deliveryDate: '2026-08-28',
      extraCostsAsked: true,
    });
    assert.match(confirm, /¿Confirmo\? \*SÍ\* \/ \*NO\*/);
    assert.doesNotMatch(confirm, /Costo extra/);
    assert.doesNotMatch(confirm, /\$1\.700/);
  });

  it('30 extra interno no cambia venta ni saldo', () => {
    const finance = planRelatedOrderFinance({
      amount: 1550,
      extraCosts: [{ nombre: 'Estampado', costo: 150 }],
      collectionAmount: 1550,
      paid: true,
      sourceText: LAISS,
    });
    assert.equal(finance.total, 1550);
    assert.equal(finance.cobro, 1550);
    assert.equal(finance.saldo, 0);
    const economics = planOrderEconomics({
      salePrice: 1550,
      baseCost: 600,
      extraCosts: [{ nombre: 'Estampado', costo: 150 }],
    });
    assert.equal(economics.salePrice, 1550);
    assert.equal(economics.baseCost, 600);
    assert.equal(economics.extraCost, 150);
    assert.equal(economics.totalCost, 750);
    assert.equal(economics.profit, 800);
    const card = presentOrderConfirm({
      clientName: 'Laissmachado - ig',
      amount: 1550,
      paid: true,
      collectionAmount: 1550,
      deliveryDate: '2026-08-28',
      notes: 'Ceibal',
      extraCosts: [{ nombre: 'Estampado', costo: 150 }],
      items: [{ quantity: 1, productName: 'Canguro felpa rojo XL' }],
      sourceText: LAISS,
    });
    assert.match(card, /Venta: \$1\.550/);
    assert.match(card, /Pago: \$1\.550 → saldo \$0/);
    assert.match(card, /Costo extra: Estampado \$150/);
    assert.doesNotMatch(card, /\$1\.700/);
    assert.doesNotMatch(card, /saldo \$150/);
    assert.doesNotMatch(card, /Total: \$1\.700/);
  });

  it('31 extra + todo pago: cobro sigue siendo la venta, no el costo interno', () => {
    const finance = planRelatedOrderFinance({
      amount: 1550,
      extraCosts: [{ nombre: 'Estampado', costo: 150 }],
      payFullBalance: true,
      paid: true,
    });
    assert.equal(finance.total, 1550);
    assert.equal(finance.cobro, 1550);
    assert.equal(finance.saldo, 0);
    const extras = parseSpokenExtraCostAnswer('sumale $200 de estampado y está todo pago');
    assert.equal(extras[0]?.costo, 200);
    assert.match(String(extras[0]?.nombre ?? ''), /estampado/i);
  });

  it('12 slot de extra: estampado $150 y NO cierran en un turno', () => {
    const parsed = parseSpokenExtraCostAnswer('estampado $150');
    assert.equal(parsed.length, 1);
    assert.match(String(parsed[0]?.nombre ?? ''), /estampado/i);
    assert.equal(parsed[0]?.costo, 150);
    for (const sample of ['$150 estampado', '150 de estampado', 'bordado $250', 'bolsa 30']) {
      assert.ok(parseSpokenExtraCostAnswer(sample).length >= 1, sample);
    }
    const many = parseSpokenExtraCostAnswer('estampado 150 y bolsa 30');
    assert.equal(many.length, 2);
    assert.equal(
      many.reduce((sum, item) => sum + item.costo, 0),
      180
    );
    assert.deepEqual(parseSpokenExtraCostAnswer('no'), []);
    assert.equal(shouldAskOrderExtraCosts({ extraCostsEnabled: true, extraCostsAsked: true, extraCosts: [] }), false);
    const noCard = presentOrderConfirm({
      clientName: 'Laissmachado - ig',
      amount: 1550,
      paid: true,
      collectionAmount: 1550,
      deliveryDate: '2026-08-28',
      notes: 'Ceibal',
      extraCosts: [],
      extraCostsAsked: true,
      items: [{ quantity: 1, productName: 'Canguro felpa rojo XL' }],
      sourceText: LAISS,
    });
    assert.match(noCard, /¿Confirmo\?/);
    assert.doesNotMatch(noCard, /Costo extra/);
  });

  it('14 extra en el primer mensaje: no vuelve a preguntar', () => {
    const text =
      'haceme un pedido de un canguro rojo XL por $1550, diseño Ceibal, estampado me cuesta $150, ya está pago, para hoy';
    const extras = extractExtraCostsFromText(text);
    assert.equal(extras[0]?.costo, 150);
    assert.match(String(extras[0]?.nombre ?? ''), /estampado/i);
    const entities = entitiesOf(text);
    assert.equal(entities.amount, 1550);
    assert.equal(entities.paid, true);
    assert.ok(entities.deliveryDate);
    assert.equal(
      shouldAskOrderExtraCosts({
        extraCostsEnabled: true,
        extraCostsAsked: false,
        extraCosts: entities.extraCosts,
      }),
      false
    );
    const finance = planRelatedOrderFinance({
      amount: entities.amount,
      extraCosts: entities.extraCosts,
      collectionAmount: entities.collectionAmount,
      paid: entities.paid,
      sourceText: text,
    });
    assert.equal(finance.total, 1550);
    assert.equal(finance.cobro, 1550);
    assert.equal(finance.saldo, 0);
  });

  it('20 negocio sin costos extra: no pregunta y usa solo el maestro', () => {
    const entities = entitiesOf(
      'registrame un pedido de un canguro rojo XL por $1550, diseño Ceibal, ya está pago, para hoy'
    );
    assert.equal(
      shouldAskOrderExtraCosts({ extraCostsEnabled: false, extraCosts: entities.extraCosts }),
      false
    );
    const economics = planOrderEconomics({
      salePrice: 1550,
      baseCost: 600,
      extraCosts: [],
    });
    assert.equal(economics.totalCost, 600);
    assert.equal(economics.profit, 950);
    const card = presentOrderConfirm({
      ...entities,
      extraCostsEnabled: false,
      extraCostsAsked: true,
    });
    assert.doesNotMatch(card, /Indicame el costo extra/);
    assert.doesNotMatch(card, /Querés agregar/);
    assert.match(card, /Venta: \$1\.550/);
    assert.match(card, /¿Confirmo\?/);
  });

  it('8 varios ítems: extra ambiguo no se asigna solo', () => {
    const entities = {
      extraCosts: [{ nombre: 'Estampado', costo: 150 }],
      items: [
        { quantity: 1, productName: 'Canguro felpa rojo XL' },
        { quantity: 1, productName: 'Buzo negro L' },
      ],
    };
    assert.equal(needsExtraCostItemAsk(entities), true);
    assert.equal(resolveExtraCostTargetIndex(entities), null);
    assert.equal(resolveExtraCostTargetIndex(entities, 'canguro'), 0);
    const hinted = extractExtraCostProductHint('al canguro agregale 150 de estampado');
    assert.match(String(hinted ?? ''), /canguro/i);
    assert.equal(needsExtraCostItemAsk({ extraCosts: [{ nombre: 'Estampado', costo: 150 }], items: [{ productName: 'Canguro felpa rojo XL' }] }), false);
  });

  it('32 estado explícito listo + pago: requestedStatus=listo, no entregado', () => {
    const entities = entitiesOf(PAID_LISTO);
    assert.equal(entities.requestedStatus, 'listo');
    assert.equal(entities.orderStatus, 'listo');
    assert.notEqual(entities.requestedStatus, 'entregado');
    assert.equal(entities.paid, true);
    const finance = planRelatedOrderFinance({
      amount: entities.amount,
      collectionAmount: entities.collectionAmount,
      paid: entities.paid,
      sourceText: PAID_LISTO,
    });
    assert.equal(finance.cobro, 1550);
    assert.equal(finance.saldo, 0);
    const card = presentOrderConfirm({ ...entities, deliveryDate: '2026-08-28' });
    assert.match(card, /Estado: Listo/);
  });

  it('33 pago sin estado explícito: no listo ni entregado', () => {
    const entities = entitiesOf(PAID_ONLY);
    assert.equal(entities.requestedStatus, undefined);
    assert.equal(entities.orderStatus, undefined);
    assert.equal(extractExplicitRequestedStatus(PAID_ONLY), undefined);
    assert.equal(entities.paid, true);
    const card = presentOrderConfirm({ ...entities, deliveryDate: '2026-08-28' });
    assert.doesNotMatch(card, /Estado:/);
  });

  it('34 descripción = Ceibal, no el pago', () => {
    const notes = sanitizeOrderNotes('diseño de ceibal ya está pago $1550');
    assert.equal(notes, 'Ceibal');
    assert.equal(extractNotesHintFromText('canguro rojo XL con diseño de Ceibal ya está pago $1550'), 'Ceibal');
  });

  it('35 Firestore: costosExtra es [] y no hay undefined', () => {
    const item = toFirestoreOrderItem({
      stockItemId: 'sku-1',
      nombre: 'Canguro felpa rojo XL',
      cantidad: 1,
      precioVenta: 1550,
      costoUnitario: 800,
    });
    assert.deepEqual(item.costosExtra, []);
    assert.notEqual(item.costosExtra, undefined);
    const doc = toFirestoreOrder({
      clienteId: 'c1',
      clienteNombre: 'Laissmachado - ig',
      descripcion: 'Ceibal',
      estado: 'pendiente',
      fechaEntrega: '2026-08-28',
      items: [item],
      total: 1550,
      costoReal: 800,
      gananciaEstimada: 750,
      numeroPedido: 1,
      numeroPedidoLabel: '00001',
      esDonacion: false,
      senia: 0,
      totalPagado: 1550,
      saldo: 0,
      pagos: [{ id: 'pago_1', tipo: 'pago', monto: 1550, fecha: '2026-08-28' }],
      seniaBloqueada: true,
      stockDescontado: false,
      stockPreparado: false,
      estadoStock: 'sin_preparar',
      fotos: [],
      origenWhatsapp: true,
      whatsappPhone: '598000',
      negocioId: 'n1',
      createdAt: '2026-08-28',
    });
    assert.deepEqual((doc.items as Array<{ costosExtra: unknown }>)[0]?.costosExtra, []);
    assert.deepEqual(findUndefinedPaths(doc), []);
    assertNoUndefinedDeep(doc, 'pedido');
  });

  it('confirmar / cancelar / corregir', () => {
    assert.equal(classifyConfirmReply('sí'), 'confirm');
    assert.equal(classifyConfirmReply('guardalo'), 'confirm');
    assert.equal(classifyConfirmReply('hacelo'), 'confirm');
    assert.equal(classifyConfirmReply('no'), 'cancel');
    assert.equal(classifyConfirmReply('cancelá'), 'cancel');
    assert.equal(classifyConfirmReply('dejalo'), 'cancel');
    assert.equal(classifyConfirmReply('no lo guardes'), 'cancel');
    assert.equal(classifyConfirmReply('no, para mañana'), 'correct');
    assert.equal(classifyConfirmReply('ponelo listo'), 'correct');
    assert.equal(classifyConfirmReply('el extra es $300'), 'correct');
  });

  it('slot de extra interpreta Estampado $250', () => {
    const extras = parseSpokenExtraCostAnswer('Estampado $250');
    assert.equal(extras.length, 1);
    assert.equal(extras[0]?.costo, 250);
    assert.match(String(extras[0]?.nombre ?? ''), /estampado/i);
  });
});
