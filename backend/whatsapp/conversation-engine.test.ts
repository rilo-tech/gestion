import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  freezeRawMessage,
  isBareDeterministicReply,
  sourceOutranks,
  utteranceGoesBeyondSlot,
} from './conversation-engine.ts';
import { buildOperationPlan } from './operation-plan.ts';
import {
  applyFollowUpToEntities,
  coalesceOrderItems,
  normalizeOrderLineItems,
} from './turn-interpreter.ts';
import { parseWithRules } from './ai-command-parser.ts';
import { ensureOrderItems } from './turn-interpreter.ts';
import { planRelatedOrderFinance } from './order-finance.ts';
import { planOrderEconomics } from './order-finance.ts';
import { shouldAskOrderExtraCosts } from './order-finance.ts';
import { businessAllowsOrderExtraCosts } from '../utils/order-config.ts';
import { applyOrderLock } from './order-lock.ts';
import { applyLanguageMemory } from './language-memory.ts';
import { parseOrderQueryFilter } from './order-query-filter.ts';
import { presentOrderCollecting } from './whatsapp-present.ts';
import { assertNoUndefinedDeep, toFirestoreOrder, toFirestoreOrderItem } from './firestore-mappers.ts';
import type { WhatsappCommandEntities } from './ai-command-parser.ts';

const LAISS =
  'registrame un pedido a Laissmachado - ig de un canguro XL rojo, diseño Ceibal, ya está pago $1550';

describe('Motor conversacional — invariantes y casos 1–11', () => {
  it('invariante: rawMessage nunca cambia', () => {
    const raw = 'un canguro XL rojo con diseño de ceibal ya esta pago $1550';
    assert.equal(freezeRawMessage(raw), raw);
    assert.equal(freezeRawMessage(raw + ''), raw);
  });

  it('SÍ / NO exactos son determinísticos; con cola extra no', () => {
    assert.equal(isBareDeterministicReply('sí'), 'confirm');
    assert.equal(isBareDeterministicReply('no'), 'cancel');
    assert.equal(isBareDeterministicReply('si, pero cambiá el talle a L'), null);
    assert.equal(isBareDeterministicReply('no, para mañana'), null);
  });

  it('provenance: corrección del usuario gana a inferencia ERP', () => {
    assert.equal(sourceOutranks('user_correction', 'erp_resolver'), true);
    assert.equal(sourceOutranks('business_default', 'user_explicit'), false);
  });

  it('CASO 1: Laissmachado — 1 ítem, Ceibal, pago 1550, sin fecha', () => {
    const parsed = parseWithRules(LAISS);
    assert.equal(parsed.intent, 'create_order');
    const entities = 'entities' in parsed ? parsed.entities ?? {} : {};
    ensureOrderItems(entities);
    assert.equal(entities.items?.length, 1);
    assert.equal(entities.items?.[0]?.quantity, 1);
    assert.match(String(entities.spokenClientName || entities.clientName), /Laissmachado - ig/i);
    assert.equal(entities.amount, 1550);
    assert.equal(entities.paid, true);
    assert.equal(entities.deliveryDate, undefined);
    const finance = planRelatedOrderFinance({
      amount: entities.amount,
      paid: entities.paid,
      sourceText: LAISS,
    });
    assert.equal(finance.total, 1550);
    assert.equal(finance.cobro, 1550);
    assert.equal(finance.saldo, 0);
    const card = presentOrderCollecting(entities, '📅 ¿Para qué fecha es la entrega?');
    assert.match(card, /Diseño: Ceibal/i);
    assert.equal((card.match(/Diseño:/g) ?? []).length, 1);
    const plan = buildOperationPlan('create_order', entities);
    assert.equal(plan.operations[0]?.intent, 'create_order');
    assert.ok(plan.operations.some((row) => row.intent === 'register_collection'));
    assert.equal(plan.operations.some((row) => row.intent === 'set_order_status'), false);
  });

  it('CASO 2: hoy y ponelo listo conserva el pedido y suma estado', () => {
    const collected: WhatsappCommandEntities = {
      clientName: 'Laissmachado - ig',
      notes: 'Ceibal',
      amount: 1550,
      paid: true,
      items: [
        {
          quantity: 1,
          rawText: 'un canguro XL rojo',
          productHint: 'canguro',
          productName: 'Canguro felpa Rojo XL',
          productId: 'sku-1',
          productLocked: true,
          itemKey: 'span:un canguro xl rojo',
          attributes: { type: 'canguro', size: 'XL', color: 'rojo' },
        },
      ],
    };
    const next = applyFollowUpToEntities(collected, 'hoy y ponelo listo', {
      type: 'field',
      field: 'deliveryDate',
    });
    assert.ok(next.deliveryDate);
    assert.equal(next.requestedStatus, 'listo');
    assert.equal(next.items?.length, 1);
    assert.equal(next.items?.[0]?.productId, 'sku-1');
    assert.equal(next.amount, 1550);
    assert.equal(next.notes, 'Ceibal');
    assert.equal(utteranceGoesBeyondSlot('hoy y ponelo listo'), true);
  });

  it('CASO 3: corrección de diseño no toca el ítem', () => {
    const collected: WhatsappCommandEntities = {
      clientName: 'Laissmachado - ig',
      notes: 'Ceibal',
      items: [
        {
          quantity: 1,
          rawText: 'canguro XL rojo',
          productName: 'Canguro felpa Rojo XL',
          productId: 'sku-1',
          itemKey: 'item-1',
          attributes: { type: 'canguro', size: 'XL', color: 'rojo' },
        },
      ],
    };
    const next = applyFollowUpToEntities(collected, 'el diseño en realidad es Ceibal 2026', {
      type: 'field',
      field: 'notes',
    });
    assert.match(String(next.notes), /Ceibal 2026/i);
    assert.equal(next.items?.length, 1);
    assert.equal(next.items?.[0]?.itemKey, 'item-1');
    assert.equal(next.items?.[0]?.productId, 'sku-1');
  });

  it('CASO 4: Cardozo que no esté entregado filtra status != entregado', () => {
    const text = 'mostrame el pedido de Cardozo que no esté entregado';
    const filter = parseOrderQueryFilter(text);
    assert.equal(filter.statusNotEquals, 'entregado');
    assert.equal(filter.listMode, 'open');
  });

  it('CASO 5: foco #00220 locked no salta a otro pedido', () => {
    const entities = applyOrderLock(
      { orderStatus: 'entregado', payFullBalance: true, paid: true },
      { id: 'ord-220', label: '00220', clientName: 'Cardozo', resolved: true, active: true, kind: 'order' },
      'ponelo entregado y cobrá todo el saldo'
    );
    assert.equal(entities.targetOrderId, 'ord-220');
    assert.equal(entities.targetOrderLabel, '00220');
    assert.equal(entities.clientName, 'Cardozo');
  });

  it('CASO 6: memoria dry coll → dry cool', () => {
    const mapped = applyLanguageMemory('una dry coll negra XL', {
      aliases: [
        {
          userExpression: 'dry coll',
          resolvedMeaning: 'dry cool',
          entityType: 'product_term',
          confirmations: 3,
          confidence: 0.98,
          lastUsedAt: '2026-08-28',
        },
      ],
    });
    assert.match(mapped, /dry cool/i);
  });

  it('CASO 7: dos productos distintos = 2 ítems', () => {
    const items = normalizeOrderLineItems(
      [
        {
          quantity: 1,
          rawText: 'Dry Cool blanca L',
          attributes: { type: 'camiseta', fabric: 'dry cool', color: 'blanco', size: 'L' },
        },
        {
          quantity: 1,
          rawText: 'Dry Cool negra XL',
          attributes: { type: 'camiseta', fabric: 'dry cool', color: 'negro', size: 'XL' },
        },
      ],
      'una Dry Cool blanca L y una Dry Cool negra XL'
    );
    assert.equal(items.length, 2);
  });

  it('CASO 8: 2 Dry Cool negras XL = un ítem quantity 2', () => {
    const items = normalizeOrderLineItems(
      [
        {
          quantity: 1,
          rawText: 'Dry Cool negra XL',
          attributes: { type: 'camiseta', fabric: 'dry cool', color: 'negro', size: 'XL' },
        },
        {
          quantity: 1,
          rawText: 'Dry Cool negra XL',
          attributes: { type: 'camiseta', fabric: 'dry cool', color: 'negro', size: 'XL' },
        },
      ],
      '2 Dry Cool negras XL'
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.quantity, 2);
  });

  it('resolver no duplica: spoken + SKU resuelto = 1 ítem', () => {
    const coalesced = coalesceOrderItems(
      [
        {
          quantity: 1,
          rawText: 'un canguro XL rojo',
          productHint: 'canguro',
          attributes: { type: 'canguro', size: 'XL', color: 'rojo' },
        },
      ],
      [
        {
          quantity: 1,
          rawText: 'Canguro felpa Rojo XL',
          productName: 'Canguro felpa Rojo XL',
          productId: 'sku-1',
          attributes: { type: 'canguro', fabric: 'felpa', size: 'XL', color: 'rojo' },
        },
      ],
      LAISS
    );
    assert.equal(coalesced.length, 1);
    assert.equal(coalesced[0]?.quantity, 1);
    assert.equal(coalesced[0]?.productId, 'sku-1');
  });

  it('CASO 9: extras deshabilitados no pregunta', () => {
    assert.equal(businessAllowsOrderExtraCosts({ costosPersonalizacionDetallados: false }), false);
    assert.equal(shouldAskOrderExtraCosts({ extraCostsEnabled: false, extraCosts: [] }), false);
  });

  it('CASO 10: extras habilitados = una pregunta', () => {
    assert.equal(shouldAskOrderExtraCosts({ extraCostsEnabled: true, extraCosts: [] }), true);
  });

  it('CASO 11: extra interno no cambia venta ni saldo', () => {
    const economics = planOrderEconomics({
      salePrice: 1550,
      baseCost: 600,
      extraCosts: [{ costo: 150 }],
    });
    assert.equal(economics.salePrice, 1550);
    assert.equal(economics.totalCost, 750);
    assert.equal(economics.profit, 800);
    const finance = planRelatedOrderFinance({
      amount: 1550,
      extraCosts: [{ nombre: 'Estampado', costo: 150 }],
      paid: true,
    });
    assert.equal(finance.total, 1550);
    assert.equal(finance.saldo, 0);
  });

  it('invariante: Firestore no recibe undefined', () => {
    const item = toFirestoreOrderItem({
      nombre: 'Canguro felpa Rojo XL',
      cantidad: 1,
      precioVenta: 1550,
      costosExtra: [],
    });
    const doc = toFirestoreOrder({
      clienteId: 'c1',
      clienteNombre: 'Laissmachado - ig',
      descripcion: 'Ceibal',
      estado: 'pendiente',
      fechaEntrega: '',
      items: [item],
      total: 1550,
      costoReal: 750,
      gananciaEstimada: 800,
      numeroPedido: 1,
      numeroPedidoLabel: '00001',
      esDonacion: false,
      senia: 0,
      totalPagado: 1550,
      saldo: 0,
      pagos: [],
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
    assertNoUndefinedDeep(doc);
  });
});
